require('dotenv').config();

const { create, SocketState } = require('@wppconnect-team/wppconnect');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { readChats, writeChats, addMessageToChat, getChatHistory, getChatMode, setChatMode, getAIInstruction, setAIInstruction, readState, writeState, deleteMessageFromChat, deleteMessageFromChatPartial } = require('./data-storage');
const axios = require('axios');
const { getAIReply } = require('./ai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);

const contactCache = {};
let syncProgress = { isRunning: false, processed: 0, total: 0 };

// Helper function to get stored API key from .env file
async function getStoredApiKey() {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '.env');
    
    try {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const lines = envContent.split('\n');
        
        for (const line of lines) {
            if (line.startsWith('GROQ_API_KEY=')) {
                return line.substring('GROQ_API_KEY='.length).trim();
            }
        }
    } catch (error) {
        // console.error('Error reading API key:', error);
    }
    return null;
}

function getAvatarUrl(seed) {
    return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(seed)}`;
}

function getGroupAvatarUrl(seed) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed)}&background=random&color=fff&size=128&bold=true`;
}

// Cache for group metadata
let groupMetadataCache = {};

async function loadGroupMetadata() {
    if (!wppClient || (wppStatus !== 'isLogged' && wppStatus !== 'inChat')) return;
    
    try {
        // Try WPP.chat.list first (wa-js API)
        let chats = [];
        if (typeof wppClient.WPP !== 'undefined' && typeof wppClient.WPP.chat === 'function') {
            chats = await wppClient.WPP.chat.list();
        } else if (typeof wppClient.getAllChats === 'function') {
            chats = await wppClient.getAllChats();
        }
        
        for (const chat of chats) {
            let chatId = chat.id;
            // Handle if chat.id is an object
            if (typeof chatId === 'object' && chatId !== null) {
                chatId = chatId._serialized || chatId.remote || JSON.stringify(chatId);
            }
                if (typeof chatId === 'string') {
                const jid = chatId.replace('@g.us', '').replace('@c.us', '');
                const isGroup = chatId.includes('@g.us');
                
                if (isGroup && chat.name) {
                    groupMetadataCache[jid] = { 
                        name: chat.name,
                        profilePicUrl: null
                    };
                }
            }
        }
        // console.error('[DEBUG] Loaded group metadata for', Object.keys(groupMetadataCache).length, 'groups');
    } catch (error) {
        // console.error('[DEBUG] Error loading group metadata:', error.message);
    }
}

async function getContactDetails(jidKey) { // Renamed parameter to jidKey for clarity
    if (!jidKey || jidKey === 'status') {
        // console.warn(`[getContactDetails] - Attempted to get contact details for invalid jidKey: ${jidKey}`);
        return { name: 'Unknown', profilePicUrl: getAvatarUrl('unknown') };
    }

    // Check if it's a group chat (has @g.us, contains dash, or starts with 12036 which is WhatsApp group prefix)
    const isGroup = jidKey.includes('@g.us') || jidKey.includes('-') || jidKey.startsWith('12036');

    // Check group metadata cache first
    if (isGroup && groupMetadataCache[jidKey]) {
        const groupData = groupMetadataCache[jidKey];
        return {
            name: groupData.name,
            profilePicUrl: groupData.profilePicUrl || getGroupAvatarUrl(jidKey)
        };
    }

    // Always prefer cache for quick lookup (but not for groups - always refresh group names)
    if (contactCache[jidKey] && !isGroup) {
        return contactCache[jidKey];
    }

    // If not in cache, try WPPConnect to get details and populate cache
    if (wppClient && (wppStatus === 'isLogged' || wppStatus === 'inChat')) {
        try {
            let fullJid, name, profilePicUrl;

            if (isGroup) {
                fullJid = jidKey.includes('@g.us') ? jidKey : `${jidKey}@g.us`;
                // For group chats, use cached metadata first
                if (groupMetadataCache[jidKey]) {
                    const groupData = groupMetadataCache[jidKey];
                    name = groupData.name;
                    // Use group name for avatar
                    profilePicUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(groupData.name)}&background=random&color=fff&size=128&bold=true`;
                } else {
                    name = jidKey;
                    profilePicUrl = getGroupAvatarUrl(jidKey);
                }
            } else {
                // For individual chats
                fullJid = jidKey.includes('@c.us') ? jidKey : `${jidKey}@c.us`;
                const contact = await wppClient.getContact(fullJid);
                name = (contact && (contact.pushname || contact.name)) ? (contact.pushname || contact.name) : jidKey;
            }
            
            profilePicUrl = getAvatarUrl(jidKey); // Start with a default avatar
            try {
                const dpUrl = await wppClient.getProfilePicFromServer(fullJid);
                if (dpUrl && (dpUrl.eurl || dpUrl.imgFull)) {
                    profilePicUrl = dpUrl.eurl || dpUrl.imgFull;
                }
            } catch (dpError) {
                // console.warn(`[getContactDetails] - Could not get profile pic for ${jidKey}:`, dpError.message);
            }
            
            const details = { name, profilePicUrl };
            contactCache[jidKey] = details; // Cache the fetched details
            return details;
        } catch (error) {
            // console.error(`[getContactDetails] - Error fetching contact details for ${jidKey} from WPPConnect:`, error.message);
            // Fallback if WPPConnect fails
            return { name: jidKey, profilePicUrl: getAvatarUrl(jidKey) };
        }
    } else {
        // console.warn(`[getContactDetails] - WPPConnect client not ready for ${jidKey}, returning fallback.`);
        // Fallback if WPPConnect client is not ready
        return { name: jidKey, profilePicUrl: getAvatarUrl(jidKey) };
    }
}

// Force WhatsApp Web to load ALL chats by scrolling
async function forceLoadAllChats(client) {
    // console.log('[forceLoadAllChats] - Starting to scroll and load all chats...');
    
    try {
        const result = await client.page.evaluate(async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            
            // Wait for pane to be available
            let attempts = 0;
            let pane = document.querySelector('#pane-side');
            while (!pane && attempts < 10) {
                await sleep(500);
                pane = document.querySelector('#pane-side');
                attempts++;
            }
            
            if (!pane) {
                // console.warn('[forceLoadAllChats] - #pane-side element not found after waiting');
                return { success: false, error: 'pane-side not found' };
            }

            // console.log('[forceLoadAllChats] - Found #pane-side, starting scroll...');
            
            let lastHeight = 0;
            let scrollAttempts = 0;
            const maxAttempts = 100; // Increase attempts
            let noChangeCount = 0;
            
            while (scrollAttempts < maxAttempts) {
                // Scroll to bottom
                pane.scrollTo(0, pane.scrollHeight);
                await sleep(2000); // Increase wait time
                
                const currentHeight = pane.scrollHeight;
                
                if (currentHeight === lastHeight) {
                    noChangeCount++;
                    if (noChangeCount >= 3) { // Try 3 more times after no change
                        // console.log('[forceLoadAllChats] - No height change for 3 attempts, stopping scroll');
                        break;
                    }
                } else {
                    noChangeCount = 0;
                }
                
                lastHeight = currentHeight;
                scrollAttempts++;
                
                if (scrollAttempts % 10 === 0) {
                    // console.log(`[forceLoadAllChats] - Scrolled ${scrollAttempts} times, current height: ${currentHeight}`);
                }
            }
            
            // Count visible chats after scrolling
            const chatElements = document.querySelectorAll('[data-testid="cell-frame-container"]');
            const totalChats = chatElements.length;
            
            // console.log(`[forceLoadAllChats] - Completed. Found ${totalChats} chat elements visible.`);
            
            return { 
                success: true, 
                scrollAttempts, 
                finalHeight: lastHeight, 
                totalChatsVisible: totalChats 
            };
        });
        
        // console.log('[forceLoadAllChats] - Scroll result:', result);
        return result;
        
    } catch (error) {
        // console.error('[forceLoadAllChats] - Error during scrolling:', error);
        return { success: false, error: error.message };
    }
}

// Get sync progress
app.get('/api/sync-progress', (req, res) => {
    res.json(syncProgress);
});

// Get contact count for sync preview
app.get('/api/sync-contacts-preview', async (req, res) => {
    // console.log('[/api/sync-contacts-preview] - Getting contact count...');
    try {
        if (!wppClient || (wppStatus !== 'isLogged' && wppStatus !== 'inChat')) {
            return res.status(400).json({ success: false, error: 'WhatsApp client not connected.' });
        }
        
        let allContacts = [];
        
        try {
            const contactsFromAPI = await wppClient.getAllContacts();
            allContacts = contactsFromAPI;
        } catch (error) {
            const allChats = await wppClient.getAllChats();
            allContacts = allChats.filter(c => !c.id.endsWith('@g.us'));
        }
        
        // Extract valid phone numbers (same filtering as sync endpoint)
        const contacts = new Set();
        for (const contact of allContacts) {
            const contactId = contact.id?._serialized || contact.id;
            if (!contactId || contactId.endsWith('@g.us') || contactId.includes('@newsletter')) continue;
            
            let phoneNumber = contactId.replace('@c.us', '').replace('@s.whatsapp.net', '');
            
            // Apply same validation as sync endpoint: must be only digits, minimum 10
            if (phoneNumber && /^\d+$/.test(phoneNumber) && phoneNumber.length >= 10) {
                contacts.add(phoneNumber);
            }
        }
        
        const count = contacts.size;
        const estimatedTime = Math.ceil(count / 20 * 1.5); // ~1.5 seconds per 20 contacts
        
        res.json({ success: true, count, estimatedTime });
    } catch (error) {
        // console.error('[/api/sync-contacts-preview] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sync contacts endpoint - Professional implementation
app.post('/api/sync-contacts', async (req, res) => {
    // console.log('[/api/sync-contacts] - Starting professional contact sync...');
    try {
        if (!wppClient || (wppStatus !== 'isLogged' && wppStatus !== 'inChat')) {
            // console.error('[/api/sync-contacts] - WhatsApp client not ready. Status:', wppStatus);
            return res.status(400).json({ success: false, error: 'WhatsApp client not connected.' });
        }

        // Initialize progress tracker
        syncProgress = { isRunning: true, processed: 0, total: 0 };

        // Step 1: Get all available contacts using multiple methods
        // console.log('[/api/sync-contacts] - Step 1: Fetching contacts with multiple methods...');
        
        let allContacts = [];
        let method = '';
        
        try {
            // Method 1: Try getAllContacts first
            // console.log('[/api/sync-contacts] - Trying getAllContacts...');
            const contactsFromAPI = await wppClient.getAllContacts();
            // console.log(`[getAllContacts] Found ${contactsFromAPI.length} contacts`);
            allContacts = contactsFromAPI;
            method = 'getAllContacts';
        } catch (error) {
            // console.log(`[getAllContacts] Failed: ${error.message}`);
            
            try {
                // Method 2: Try getAllChats as fallback
                // console.log('[/api/sync-contacts] - Trying getAllChats as fallback...');
                const allChats = await wppClient.getAllChats();
                // console.log(`[getAllChats] Found ${allChats.length} total chats`);
                
                // Convert chats to contacts format
                allContacts = allChats
                    .filter(chat => chat.id && !chat.isGroup && !chat.isBroadcast && chat.id !== 'status@broadcast')
                    .map(chat => ({
                        id: chat.id,
                        name: chat.name || chat.formattedName || chat.pushname || chat.id.replace('@c.us', ''),
                        pushname: chat.pushname,
                        isMyContact: chat.isMyContact,
                        isWAContact: chat.isWAContact
                    }));
                
                method = 'getAllChats';
                // console.log(`[getAllChats] Converted to ${allContacts.length} valid contacts`);
            } catch (chatError) {
                // console.log(`[getAllChats] Also failed: ${chatError.message}`);
                throw new Error('Both getAllContacts and getAllChats failed');
            }
        }
        
        // console.log(`[/api/sync-contacts] - Using method: ${method}, got ${allContacts.length} contacts`);

        // Step 2: Process contacts and extract unique phone numbers
        // console.log('[/api/sync-contacts] - Step 2: Processing contacts...');
        const contacts = new Set();
        const validContacts = [];
        
        // Debug: Log first few contact structures
        // console.log('[/api/sync-contacts] - Sample contact structures:');
        for (let i = 0; i < Math.min(3, allContacts.length); i++) {
            const contact = allContacts[i];
            // console.log(`  Contact ${i}:`, {
            //     id: contact.id,
            //     idType: typeof contact.id,
            //     name: contact.name,
            //     pushname: contact.pushname,
            //     isUser: contact.isUser,
            //     isGroup: contact.isGroup
            // });
        }

        for (const contact of allContacts) {
            try {
                if (!contact.id) {
                    // console.log(`  Skipping contact without ID`);
                    continue;
                }
                
                // Handle different ID formats - might be an object with _serialized property
                let contactId = contact.id;
                if (typeof contact.id === 'object' && contact.id._serialized) {
                    contactId = contact.id._serialized;
                } else if (typeof contact.id !== 'string') {
                    // console.log(`  Skipping contact with invalid ID type: ${typeof contact.id}`);
                    continue;
                }
                
                // Extract phone number from JID
                let phoneNumber = contactId.replace('@c.us', '').replace('@s.whatsapp.net', '');
                
                if (phoneNumber && /^\d+$/.test(phoneNumber) && phoneNumber.length >= 10) {
                    if (!contacts.has(phoneNumber)) {
                        contacts.add(phoneNumber);
                        validContacts.push({
                            ...contact,
                            id: contactId,
                            number: phoneNumber
                        });
                    }
                } else {
                    // console.log(`  Skipping invalid phone number: ${phoneNumber} from contact: ${contactId}`);
                }
            } catch (error) {
                // console.log(`  Error processing contact:`, error.message);
            }
        }
        
        // console.log(`[/api/sync-contacts] - Extracted ${contacts.size} unique valid contacts`);
        syncProgress.total = validContacts.length;

        // console.log(`[/api/sync-contacts] - Extracted ${contacts.size} unique contact numbers`);

        // Step 3: Fetch full contact info for each contact
        // console.log('[/api/sync-contacts] - Step 3: Fetching detailed contact info...');
        const fullContacts = [];
        let processedCount = 0;

        for (const contact of validContacts) {
            try {
                const fullJid = `${contact.number}@c.us`;
                let detailedContact = contact;
                
                // Try to get more detailed info if we don't have it already
                if (method === 'getAllChats' || !contact.name || contact.name === contact.number) {
                    try {
                        const contactDetails = await wppClient.getContact(fullJid);
                        detailedContact = {
                            ...contact,
                            name: contactDetails.pushname || contactDetails.name || contact.name,
                            verifiedName: contactDetails.verifiedName,
                            isBusiness: contactDetails.isBusiness,
                            isMyContact: contactDetails.isMyContact,
                            isWAContact: contactDetails.isWAContact
                        };
                    } catch (detailError) {
                        // console.log(`  Could not get details for ${contact.number}, using basic info`);
                    }
                }
                
                // Get profile picture
                let profilePicUrl = getAvatarUrl(contact.number);
                try {
                    const dpResult = await wppClient.getProfilePicFromServer(fullJid);
                    if (dpResult && (dpResult.eurl || dpResult.imgFull)) {
                        profilePicUrl = dpResult.eurl || dpResult.imgFull;
                    }
                } catch (dpError) {
                    // Use default avatar if profile pic fails
                }

                const fullContactInfo = {
                    id: fullJid,
                    number: contact.number,
                    name: detailedContact.name || contact.number,
                    verifiedName: detailedContact.verifiedName,
                    isBusiness: detailedContact.isBusiness || false,
                    isMyContact: detailedContact.isMyContact || false,
                    isWAContact: detailedContact.isWAContact || false,
                    profilePicUrl: profilePicUrl
                };

                fullContacts.push(fullContactInfo);
                
                // Update contact cache
                contactCache[contact.number] = {
                    name: fullContactInfo.name,
                    profilePicUrl: profilePicUrl
                };

                processedCount++;
                syncProgress.processed = processedCount;
                if (processedCount % 20 === 0) {
                    // console.log(`[/api/sync-contacts] - Processed ${processedCount}/${validContacts.length} contacts...`);
                }
            } catch (error) {
                // console.warn(`[/api/sync-contacts] - Failed to process ${contact.number}:`, error.message);
                // Still add basic contact info even if detailed fetch fails
                fullContacts.push({
                    id: `${contact.number}@c.us`,
                    number: contact.number,
                    name: contact.name || contact.number,
                    verifiedName: null,
                    isBusiness: false,
                    isMyContact: false,
                    isWAContact: false,
                    profilePicUrl: getAvatarUrl(contact.number)
                });
            }
        }

        // console.log(`[/api/sync-contacts] - Successfully processed ${fullContacts.length} contacts using method: ${method}`);

        // Step 5: Update persistent storage
        // console.log('[/api/sync-contacts] - Step 5: Updating chats.json...');
        let chats = await readChats();
        
        for (const contact of fullContacts) {
            const jidKey = contact.number;
            if (!chats[jidKey]) {
                chats[jidKey] = [];
                // console.log(`[/api/sync-contacts] - Created chat entry for ${jidKey}`);
            }
        }

        await writeChats(chats);
        // console.log('[/api/sync-contacts] - Updated chats.json successfully');

        // Prepare response with contact info
        const chatsWithContactInfo = {};
        for (const jidKey in chats) {
            const contactDetails = contactCache[jidKey] || { 
                name: jidKey, 
                profilePicUrl: getAvatarUrl(jidKey) 
            };
            
            chatsWithContactInfo[jidKey] = {
                messages: chats[jidKey],
                contact: contactDetails
            };
        }

        // console.log(`[/api/sync-contacts] - Professional sync completed: ${fullContacts.length} contacts, ${Object.keys(chatsWithContactInfo).length} chats`);
        syncProgress = { isRunning: false, processed: 0, total: 0 };

        res.json({ 
            success: true, 
            contacts: fullContacts, 
            updatedChats: chatsWithContactInfo,
            totalProcessed: fullContacts.length
        });

    } catch (error) {
        // console.error('[/api/sync-contacts] - Critical error during professional sync:', error);
        syncProgress = { isRunning: false, processed: 0, total: 0 };
        res.status(500).json({ 
            success: false, 
            error: 'Failed to sync contacts', 
            message: error.message 
        });
    }
});

// API Endpoints...
app.get('/api/chats', async (req, res) => {
    try {
        // Ensure group metadata is loaded
        if (Object.keys(groupMetadataCache).length === 0) {
            await loadGroupMetadata();
        }
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        
        const chats = await readChats();
        const chatEntries = Object.entries(chats);
        
        // Sort by last message timestamp (most recent first)
        chatEntries.sort((a, b) => {
            const lastMsgA = a[1][a[1].length - 1];
            const lastMsgB = b[1][b[1].length - 1];
            const timeA = lastMsgA ? new Date(lastMsgA.timestamp).getTime() : 0;
            const timeB = lastMsgB ? new Date(lastMsgB.timestamp).getTime() : 0;
            return timeB - timeA;
        });
        
        // Get paginated entries
        const paginatedEntries = chatEntries.slice(offset, offset + limit);
        
        const chatsWithContactInfo = {};
        for (const [jid, messages] of paginatedEntries) {
            try {
                const contactDetails = await getContactDetails(jid);
                chatsWithContactInfo[jid] = {
                    messages: messages,
                    contact: contactDetails
                };
            } catch (contactError) {
                // console.log(`Failed to get contact details for ${jid}:`, contactError.message);
                chatsWithContactInfo[jid] = {
                    messages: messages,
                    contact: {
                        name: jid,
                        profilePicUrl: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(jid)}`
                    }
                };
            }
        }
        
        // Send paginated response
        res.json({
            chats: chatsWithContactInfo,
            pagination: {
                currentPage: page,
                limit: limit,
                total: chatEntries.length,
                totalPages: Math.ceil(chatEntries.length / limit),
                hasMore: offset + limit < chatEntries.length
            }
        });
    } catch (error) {
        // console.error('Error in /api/chats:', error);
        res.status(500).send('Error fetching chat history');
    }
});
app.get('/api/contacts', (req, res) => res.json(contactCache));
app.get('/api/profile-pic/:jid', async (req, res) => {
    try {
        if (!wppClient || (wppStatus !== 'isLogged' && wppStatus !== 'inChat')) {
            return res.status(503).send('WhatsApp client not ready');
        }
        const jid = req.params.jid + '@c.us';
        const dpUrl = await wppClient.getProfilePicFromServer(jid);
        const picUrl = dpUrl && (dpUrl.eurl || dpUrl.imgFull) ? (dpUrl.eurl || dpUrl.imgFull) : null;
        if (!picUrl) return res.status(404).send('No profile pic');

        const response = await axios.get(picUrl, { responseType: 'arraybuffer' });
        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.send(Buffer.from(response.data, 'binary'));
    } catch (error) {
        res.status(500).send('Error fetching profile pic');
    }
});
app.get('/api/mode/:jid', async (req, res) => {
    try {
        const mode = await getChatMode(req.params.jid);
        res.json({ mode });
    } catch (error) {
        res.status(500).send('Error getting chat mode');
    }
});
app.post('/api/mode/:jid', async (req, res) => {
    try {
        await setChatMode(req.params.jid, req.body.mode);
        res.json({ success: true });
    } catch (error) {
        res.status(500).send('Error setting chat mode');
    }
});
app.get('/api/ai-instruction', async (req, res) => {
    try {
        const instruction = await getAIInstruction();
        res.json({ instruction });
    } catch (error) {
        res.status(500).send('Error getting AI instruction');
    }
});
app.post('/api/ai-instruction', async (req, res) => {
    try {
        await setAIInstruction(req.body.instruction);
        res.json({ success: true });
    } catch (error) {
        res.status(500).send('Error setting AI instruction');
    }
});
app.post('/api/ai-suggest', async (req, res) => {
    try {
        const { message } = req.body;
        const instruction = await getAIInstruction();
        const apiKey = await getStoredApiKey();
        const aiReply = await getAIReply(message, instruction, apiKey);
        res.json({ reply: aiReply });
    } catch (error) {
        res.status(500).send('Error getting AI suggestion');
    }
});
app.post('/api/rewrite-formal', async (req, res) => {
    try {
        const { message } = req.body;
        const formalRewriteInstruction =
            'Rewrite the user message in a clear, polite, formal tone. Preserve meaning. Return only the rewritten message text.';
        const apiKey = await getStoredApiKey();
        const rewritten = await getAIReply(message, formalRewriteInstruction, apiKey);
        res.json({ rewritten });
    } catch (error) {
        res.status(500).send('Error rewriting message');
    }
});

// Settings API endpoints
app.post('/api/settings', async (req, res) => {
    try {
        const { groqApiKey, aiTraining, aiSchedule } = req.body;
        
        // Save to .env file
        const fs = require('fs').promises;
        const path = require('path');
        const envPath = path.join(__dirname, '.env');
        
        let envContent = '';
        try {
            envContent = await fs.readFile(envPath, 'utf-8');
        } catch (error) {
            envContent = '';
        }
        
        // Update or add settings
        const lines = envContent.split('\n');
        let hasApiKey = false;
        let hasTraining = false;
        let hasSchedule = false;
        
        const updatedLines = lines.map(line => {
            if (line.startsWith('GROQ_API_KEY=')) {
                hasApiKey = true;
                return `GROQ_API_KEY=${groqApiKey}`;
            }
            if (line.startsWith('AI_TRAINING=')) {
                hasTraining = true;
                return `AI_TRAINING="${aiTraining.replace(/"/g, '\\"')}"`;
            }
            if (line.startsWith('AI_SCHEDULE=')) {
                hasSchedule = true;
                return `AI_SCHEDULE="${aiSchedule.replace(/"/g, '\\"')}"`;
            }
            return line;
        });
        
        // Add new settings if they don't exist
        if (!hasApiKey) {
            updatedLines.push(`GROQ_API_KEY=${groqApiKey}`);
        }
        if (!hasTraining) {
            updatedLines.push(`AI_TRAINING="${aiTraining.replace(/"/g, '\\"')}"`);
        }
        if (!hasSchedule) {
            updatedLines.push(`AI_SCHEDULE="${aiSchedule.replace(/"/g, '\\"')}"`);
        }
        
        const newContent = updatedLines.join('\n');
        await fs.writeFile(envPath, newContent);
        
        // console.log('Settings saved successfully to .env');
        // console.log('AI Training:', aiTraining ? 'Updated' : 'Empty');
        // console.log('AI Schedule:', aiSchedule ? 'Updated' : 'Empty');
        
        res.json({ success: true });
    } catch (error) {
        // console.error('Error saving settings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete message API
app.delete('/api/delete-message/:chatId/:messageId', async (req, res) => {
    try {
        const { chatId, messageId } = req.params;
        const deleteForEveryone = req.query.everyone === 'true';
        
        // Try exact match first
        let deleted = await deleteMessageFromChat(chatId, messageId);
        
        // If not found, try partial match
        if (!deleted) {
            deleted = await deleteMessageFromChatPartial(chatId, messageId);
        }
        
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Message not found in local storage' });
        }
        
        // If delete for everyone, try to delete from WhatsApp
        if (deleteForEveryone && wppClient && (wppStatus === 'isLogged' || wppStatus === 'inChat')) {
            try {
                const fullJid = chatId.includes('@c.us') || chatId.includes('@g.us') 
                    ? chatId 
                    : `${chatId}@c.us`;
                
                // Use WPP.chat.deleteMessage with revoke=true for delete for everyone
                if (typeof wppClient.WPP !== 'undefined' && typeof wppClient.WPP.chat === 'object') {
                    await wppClient.WPP.chat.deleteMessage(fullJid, messageId, false, true);
                } else if (typeof wppClient.deleteMessage === 'function') {
                    await wppClient.deleteMessage(fullJid, messageId, false, true);
                }
            } catch (waError) {
                // Message is already deleted from local storage
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/settings', async (req, res) => {
    try {
        const fs = require('fs').promises;
        const path = require('path');
        const envPath = path.join(__dirname, '.env');
        
        let envContent = '';
        try {
            envContent = await fs.readFile(envPath, 'utf-8');
        } catch (error) {
            envContent = '';
        }
        
        const lines = envContent.split('\n');
        const settings = {};
        
        lines.forEach(line => {
            if (line.startsWith('GROQ_API_KEY=')) {
                settings.groqApiKey = line.substring('GROQ_API_KEY='.length);
            } else if (line.startsWith('AI_TRAINING=')) {
                settings.aiTraining = line.substring('AI_TRAINING='.length).replace(/"/g, '');
            } else if (line.startsWith('AI_SCHEDULE=')) {
                settings.aiSchedule = line.substring('AI_SCHEDULE='.length).replace(/"/g, '');
            }
        });
        
        res.json(settings);
    } catch (error) {
        // console.error('Error getting settings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Manual sync endpoint for testing
app.post('/api/sync-sent-messages', async (req, res) => {
    if (!wppClient) {
        return res.status(500).json({ error: 'WPPConnect not ready' });
    }
    
    try {
        const chats = await wppClient.getAllChats();
        // Sync from all chats, not just recent ones
        const recentChats = chats.slice(0, 20);
        
        let syncedCount = 0;
        
        for (const chat of recentChats) {
            const chatId = chat.id._serialized || chat.id;
            const jid = chatId.replace('@c.us', '').replace('@g.us', '');
            
            try {
                const messages = await wppClient.getAllMessagesInChat(chatId, true, false);
                if (!messages?.length) continue;
                
                const recentSent = messages
                    .filter(m => m.fromMe && m.t > Math.floor((Date.now() - 60000) / 1000))
                    .sort((a, b) => a.t - b.t);
                
                for (const msg of recentSent) {
                    const content = msg.body || msg.caption || '';
                    if (!content) continue;
                    
                    const msgId = msg.id?._serialized || msg.id;
                    const msgTimestamp = new Date(msg.t * 1000).toISOString();
                    
                    const sentMessage = {
                        id: msgId,
                        subType: msg.type === 'ptt' ? 'audio' : (msg.type || 'chat'),
                        content: content,
                        timestamp: msgTimestamp,
                        direction: 'sent'
                    };
                    
                    const inserted = await addMessageToChat(jid, sentMessage);
                    if (inserted) {
                        syncedCount++;
                        const contact = await getContactDetails(jid);
                        const payload = {
                            type: 'message',
                            subType: sentMessage.subType,
                            from: jid,
                            content: content,
                            timestamp: msgTimestamp,
                            direction: 'sent',
                            contactName: contact.name,
                            contactProfilePicUrl: contact.profilePicUrl
                        };
                        wss.clients.forEach(c => {
                            if (c.readyState === WebSocket.OPEN) {
                                c.send(JSON.stringify(payload));
                            }
                        });
                    }
                }
            } catch (e) {
                // Skip
            }
        }
        
        res.json({ success: true, syncedCount });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// WebSocket Server Setup
const wss = new WebSocket.Server({ server });
let wppClient = null;
let wppStatus = null;
const lastSyncedMetaSentTsByJid = new Map();
const lastSyncedMetaReceivedTsByJid = new Map();

wss.on('connection', ws => {
    // console.log('Frontend connected');
    ws.on('message', async message => {
        const msg = JSON.parse(message);
        if (!wppClient || (wppStatus !== 'isLogged' && wppStatus !== 'inChat')) {
            // console.warn('WPPConnect client not ready. Status:', wppStatus);
            // console.warn('Client exists:', !!wppClient);
            return;
        }

        // Properly format JID - ensure it's a valid phone number
        let jid = msg.to;
        
        // Remove any existing suffix and characters
        if (jid.includes('@')) {
            jid = jid.split('@')[0];
        }
        
        // Remove any non-digit characters
        jid = jid.replace(/\D/g, '');
        
        // Validate phone number format
        if (!jid || jid.length < 10) {
            // console.error('Invalid phone number format:', jid, 'Original:', msg.to);
            return;
        }
        
        // Remove leading zeros and ensure proper format
        jid = jid.replace(/^0+/, '');
        
        // Try different JID formats
        let jidFormats = [
            jid + '@c.us',
            jid + '@s.whatsapp.net', 
            jid + '@lid'
        ];

        // console.log('Processing message:', {
        //     type: msg.type, 
        //     originalTo: msg.to, 
        //     cleanedTo: jid.replace('@c.us', ''), 
        //     formattedJid: jid, 
        //     id: msg.id,
        //     messageLength: msg.message ? msg.message.length : 0
        // });

        if (msg.type === 'send') { // Text message
            try {
                let outgoingText = msg.message;
                // console.log('Sending text to:', jid, 'Message:', outgoingText);
                const mode = await getChatMode(msg.to);
                const originalMessage = msg.message;
                let finalMessage = originalMessage;

                if (mode === 'B' && !msg.is_rewritten_preview) {
                    try {
                        // Get chat history for context
                        const chatHistory = await getChatHistory(msg.to, 5); // Last 5 messages
                        
                        // Check if message contains Hindi characters or common Hinglish patterns
                        const hasHindiChars = /[\u0900-\u097F]/.test(originalMessage);
                        const hasHinglishPatterns = /\b(tum|tera|mera|maim|main|kaun|kya|kaise|kyu|abhi|aur|yeh|woh|hai|ho|raha|rahi|rhe|hoga|kar|rahe|karo|karna|karni|hain|se|ko|ki|ke|me|mein|pe|theek|thik|accha|achha|chalo|chal|ruk|dekh|btao|karunga|karogi|hu|hun|hota|hogaya|hua|tha|thi|the|sab|kuch|sirf|bas|phir|fir|to|yehi|wahi|iska|uska|unka|mera|tera|unka|hamara|apna|dusra|doosra|ek|do|teen|char|panch|haan|nahi|nahin|matlab|kaha|kahan|kidhar|idhar|udhar|acha|acchi|acche|bura|buri|buri|sahi|galat|kaafi|bohot|jada|kam|zyada|pata|kalam|kal|aaj|raat|din|subah|shaam|phla|pahla|baad|pichla|agli|agle|pehla| last|next|previous)\b/i.test(originalMessage) && /[a-zA-Z]/.test(originalMessage);
                        
                        let rewriteRequest;
                        if (hasHindiChars || hasHinglishPatterns) {
                            // Convert Hinglish to English
                            rewriteRequest = `Convert Hinglish/Hindi to English. Examples: "mai theek hu" -> "I am fine", "tum kya kar rahe ho" -> "What are you doing", "kya haal hai" -> "How are you". Translate to English only. NO Hindi words. Output ONLY the English.
Input: ${originalMessage}
Output:`;
                        } else {
                            // Just fix grammar for English text
                            rewriteRequest = `Fix grammar/punctuation only. Output ONLY the fixed text, nothing else.
Input: ${originalMessage}
Output:`;
                        }
                        
                        const apiKey = await getStoredApiKey();
                        const rewritten = await getAIReply(rewriteRequest, "You are a text formatter. Return ONLY the corrected text, no explanations.", apiKey);
                        
                        // Only use rewrite if it doesn't add new content (indicates AI followed instructions)
                        if (typeof rewritten === 'string' && rewritten.trim() && 
                            rewritten.trim().length <= originalMessage.length * 1.5 &&
                            !rewritten.toLowerCase().includes("i'd be happy") &&
                            !rewritten.toLowerCase().includes("i can help") &&
                            !rewritten.toLowerCase().includes("here is")) {
                            finalMessage = rewritten.trim();
                        }
                    } catch (rewriteError) {
                        // console.error('Semi-AI rewrite failed, sending original message:', rewriteError.message);
                    }
                }

                // Always store original message first
                const timestamp = new Date().toISOString();
                const clientMessageId = msg.id;
                const originalMessageForDb = {
                    id: clientMessageId,
                    subType: 'chat',
                    content: originalMessage,
                    timestamp: timestamp,
                    direction: 'sent',
                    isOriginalInSemiAI: mode === 'B' // Persist semi-AI status
                };

                const contactDetails = await getContactDetails(msg.to);
                
                // Store original message first
                await addMessageToChat(msg.to, originalMessageForDb);
                
                // Broadcast original message to all clients with special flag for semi-AI mode
                const originalPayloadForWs = {
                    type: 'message',
                    from: msg.to,
                    subType: 'chat',
                    content: originalMessage,
                    timestamp: originalMessageForDb.timestamp,
                    direction: 'sent',
                    contactName: contactDetails.name,
                    contactProfilePicUrl: contactDetails.profilePicUrl,
                    id: originalMessageForDb.id,
                    isOriginalInSemiAI: mode === 'B'
                };
                
                // console.log('Broadcasting original message to clients:', originalPayloadForWs);
                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify(originalPayloadForWs));
                    }
                });

                // Send the final message (rewritten if in semi-AI mode, otherwise original)
                // Try different JID formats
                let sent = false;
                for (const testJid of jidFormats) {
                    try {
                        await wppClient.sendText(testJid, finalMessage);
                        sent = true;
                        break;
                    } catch (e) {
                        // Try next format
                    }
                }
                
                if (!sent) {
                    // Fallback: try without any suffix
                    try {
                        await wppClient.sendText(jid, finalMessage);
                    } catch (e) {}
                }
                
                // If message was rewritten, also store and broadcast the AI version
                if (finalMessage !== originalMessage) {
                    const aiMessageId = `ai_rewrite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const aiMessageForDb = {
                        id: aiMessageId,
                        subType: 'chat',
                        content: finalMessage,
                        timestamp: new Date().toISOString(),
                        direction: 'sent',
                        isAIRewrite: true // Persist AI rewrite status
                    };
                    
                    // Store AI message in database
                    await addMessageToChat(msg.to, aiMessageForDb);
                    
                    // Broadcast AI message to all clients
                    const aiPayloadForWs = {
                        type: 'message',
                        from: msg.to,
                        subType: 'chat',
                        content: finalMessage,
                        timestamp: aiMessageForDb.timestamp,
                        direction: 'sent',
                        contactName: contactDetails.name,
                        contactProfilePicUrl: contactDetails.profilePicUrl,
                        id: aiMessageForDb.id,
                        isAIRewrite: true
                    };
                    
                    // console.log('Broadcasting AI message to clients:', aiPayloadForWs);
                    wss.clients.forEach(c => {
                        if (c.readyState === WebSocket.OPEN) {
                            c.send(JSON.stringify(aiPayloadForWs));
                        }
                    });
                }
                
                // console.log(`Stored and broadcast outgoing message to ${msg.to}: ${outgoingText}`);
            } catch (error) {
                // console.error('Failed to send text message:', error);
            }
        } else if (msg.type === 'send-file') { // File message
            try {
                // Apply same JID formatting for file messages
                let fileJid = msg.to;
                
                // Remove any existing suffix and add @c.us
                if (fileJid.includes('@')) {
                    fileJid = fileJid.split('@')[0];
                }
                
                // Validate phone number format
                if (!/^\d+$/.test(fileJid)) {
                    // console.error('Invalid phone number format for file:', fileJid);
                    return;
                }
                
                fileJid = fileJid + '@c.us';

                // console.log('Received file message on server:', {
                //     subType: msg.subType,
                //     mimetype: msg.mimetype,
                //     filename: msg.filename,
                //     contentLength: msg.content ? msg.content.length : 0,
                //     formattedJid: fileJid
                // });
                
                // Create the full data URL that WPPConnect expects
                let dataUrl = msg.content;
                if (!msg.content.startsWith('data:')) {
                    dataUrl = `data:${msg.mimetype};base64,${msg.content}`;
                }
                
                // console.log('Using data URL:', dataUrl.substring(0, 50) + '...');
                
                // Use the new sendFileMessage API
                const options = {
                    type: msg.subType,
                    caption: msg.caption || msg.filename,
                    filename: msg.filename,
                    mimetype: msg.mimetype
                };
                
                // Special handling for audio (PTT)
                if (msg.subType === 'audio') {
                    options.isPtt = true;
                }
                
                // CRITICAL: Use base64-specific functions for base64 data URLs
                if (msg.subType === 'image' || msg.subType === 'sticker') {
                    // console.log('Sending image via sendImageFromBase64');
                    await wppClient.sendImageFromBase64(fileJid, dataUrl, msg.filename, msg.caption || '');
                } else if (msg.subType === 'video') {
                    // console.log('Sending video via sendVideoFromBase64');
                    await wppClient.sendVideoFromBase64(fileJid, dataUrl, msg.filename, msg.caption || '');
                } else if (msg.subType === 'audio') {
                    // console.log('Sending audio via sendAudioFromBase64');
                    await wppClient.sendAudioFromBase64(fileJid, dataUrl, msg.filename, msg.caption || '');
                } else {
                    // console.log('Sending document via sendDocumentFromBase64');
                    await wppClient.sendDocumentFromBase64(fileJid, dataUrl, msg.filename, msg.caption || '');
                }
                
                // Immediately store and broadcast outgoing file message
                const timestamp = new Date().toISOString();
                const messageForDb = {
                    id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    subType: msg.subType,
                    content: msg.content,
                    mimetype: msg.mimetype,
                    timestamp: timestamp,
                    direction: 'sent'
                };
                
                const contactDetails = await getContactDetails(msg.to);
                const payloadForWs = {
                    type: 'message',
                    from: msg.to,
                    subType: msg.subType,
                    content: msg.content,
                    mimetype: msg.mimetype,
                    timestamp: timestamp,
                    direction: 'sent',
                    contactName: contactDetails.name,
                    contactProfilePicUrl: contactDetails.profilePicUrl,
                    id: messageForDb.id
                };
                
                // Store in database
                await addMessageToChat(msg.to, messageForDb);
                
                // Broadcast to all connected clients
                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify(payloadForWs));
                    }
                });
                
                // console.log(`Stored and broadcast outgoing ${msg.subType} to ${msg.to}`);
            } catch (error) {
                // console.error('Failed to send file message:', error);
            }
        }
    });
});

function startWPPConnect() {
    create({
        session: 'whats-ai-client',
        puppeteerOptions: { userDataDir: path.join(__dirname, 'tokens', 'whats-ai-client') },
        catchQR: (base64qr) => {
            wss.clients.forEach(c => c.send(JSON.stringify({ type: 'qr', data: `data:image/png;base64,${base64qr}` })));
        },
        statusFind: (statusSession) => {
            wppStatus = statusSession;
            // console.log('WPPConnect Status:', statusSession);
            if (statusSession === 'isLogged' || statusSession === 'inChat') {
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'connected' })));
                loadGroupMetadata();
            }
        },
        headless: true,
        devtools: false,
        useChrome: true,
        browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
        logQR: true,
        autoClose: 90000,
        disableSpins: true,
    })
    .then((client) => {
        wppClient = client;
        client.onMessage(async (message) => {
            // console.log('Received a message:', message.id);
            const fromJid = message.from || '';
            const isStatus = fromJid === 'status@broadcast' || message.isStatus || message.type === 'status';
            const isChannel = fromJid.endsWith('@newsletter') || message.isNewsletter || message.isChannel;
            const isBroadcast = fromJid.endsWith('@broadcast') || message.isBroadcast;
            const isFiltered = message.isGroupMsg || isStatus || isChannel || isBroadcast;

            if (isFiltered) {
                // console.log('Filtered message sample:', {
                //     from: message.from,
                //     type: message.type,
                //     isStatus: message.isStatus,
                //     isNewsletter: message.isNewsletter,
                //     isChannel: message.isChannel,
                //     isBroadcast: message.isBroadcast,
                //     isGroupMsg: message.isGroupMsg
                // });
                return;
            }

            const toJidPart = (value) => typeof value === 'string' ? value.split('@')[0] : '';
            const senderJid = message.fromMe
                ? (toJidPart(message.to) || toJidPart(message.invokedBotWid) || toJidPart(message.chatId) || toJidPart(message.from))
                : toJidPart(message.from);
            if (!senderJid) {
                // console.warn(`Unable to resolve sender JID for message ${message.id}`);
                return;
            }
            const timestamp = new Date(message.t * 1000).toISOString();
            
            const direction = message.fromMe ? 'sent' : 'received';
            let messageForDb = { id: message.id, timestamp, direction };
            let payloadForWs = { type: 'message', from: senderJid, timestamp, direction };
            const looksLikeBase64Blob = (value) =>
                typeof value === 'string' &&
                value.length > 200 &&
                /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
                !/\s/.test(value);
            const getSerializedId = (msgObj) => {
                const idVal = msgObj?.id;
                if (typeof idVal === 'string') return idVal;
                if (idVal && typeof idVal === 'object') {
                    if (typeof idVal._serialized === 'string') return idVal._serialized;
                    if (typeof idVal.id === 'string' && typeof idVal.remote === 'string') {
                        const fromMePrefix = idVal.fromMe === true ? 'true' : 'false';
                        return `${fromMePrefix}_${idVal.remote}_${idVal.id}`;
                    }
                }
                return '';
            };
            const mediaTypeSet = new Set(['image', 'sticker', 'video', 'audio', 'ptt', 'document']);
            const isLikelyMediaMessage = message.hasMedia || mediaTypeSet.has(message.type);
            const extractTextContent = (msgObj) => {
                const candidates = [
                    msgObj?.body,
                    msgObj?.caption,
                    msgObj?.text,
                    msgObj?.content,
                    msgObj?.title,
                    msgObj?.description,
                    msgObj?.message?.conversation,
                    msgObj?.message?.extendedTextMessage?.text,
                    msgObj?.message?.extendedTextMessage?.matchedText,
                    msgObj?.message?.extendedTextMessage?.canonicalUrl,
                    msgObj?.message?.listResponseMessage?.title,
                    msgObj?.message?.buttonsResponseMessage?.selectedDisplayText,
                    msgObj?.message?.templateButtonReplyMessage?.selectedDisplayText,
                    msgObj?.interactiveResponse?.body?.text,
                    msgObj?.quotedMsg?.body
                ];

                if (msgObj?.richResponse?.fragments?.length) {
                    const richParts = msgObj.richResponse.fragments
                        .filter(f => f && typeof f.text === 'string')
                        .map(f => f.text.trim())
                        .filter(Boolean);
                    if (richParts.length) {
                        candidates.push(richParts.join(' '));
                        candidates.push(...richParts);
                    }
                }

                const normalized = candidates
                    .filter(v => typeof v === 'string')
                    .map(v => v.trim())
                    .filter(v => !looksLikeBase64Blob(v))
                    .filter(Boolean);

                if (!normalized.length) {
                    return '';
                }

                // Prefer the richest candidate (Meta AI/mobile payloads often include multiple text fields).
                return normalized.sort((a, b) => b.length - a.length)[0];
            };
            const syncRecentMetaSentMessages = async () => {
                if (senderJid !== '13135550002') {
                    return;
                }
                try {
                    const chatId = `${senderJid}@c.us`;
                    const recentMessages = await client.getAllMessagesInChat(chatId, true, false);
                    if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
                        return;
                    }

                    const lastSyncedTs = lastSyncedMetaSentTsByJid.get(senderJid) || 0;
                    let newestSyncedTs = lastSyncedTs;
                    const candidates = recentMessages
                        .slice(-120)
                        .filter((msgItem) => msgItem?.fromMe && Number(msgItem?.t || 0) > lastSyncedTs)
                        .sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0));

                    for (const msgItem of candidates) {
                        if (!msgItem?.fromMe) {
                            continue;
                        }
                        const itemTsSeconds = Number(msgItem?.t || 0);
                        if (itemTsSeconds > newestSyncedTs) {
                            newestSyncedTs = itemTsSeconds;
                        }
                        const text = extractTextContent(msgItem);
                        if (!text) {
                            continue;
                        }

                        const msgId = getSerializedId(msgItem);
                        if (!msgId) {
                            continue;
                        }
                        const msgTimestamp = msgItem.t
                            ? new Date(msgItem.t * 1000).toISOString()
                            : timestamp;
                        const sentMessage = {
                            id: msgId,
                            subType: 'chat',
                            content: text,
                            timestamp: msgTimestamp,
                            direction: 'sent'
                        };

                        const inserted = await addMessageToChat(senderJid, sentMessage);
                        if (!inserted) {
                            continue;
                        }

                        const metaContact = await getContactDetails(senderJid);
                        const sentPayload = {
                            type: 'message',
                            subType: 'chat',
                            from: senderJid,
                            content: text,
                            timestamp: msgTimestamp,
                            direction: 'sent',
                            contactName: metaContact.name,
                            contactProfilePicUrl: metaContact.profilePicUrl
                        };
                        wss.clients.forEach(c => {
                            if (c.readyState === WebSocket.OPEN) {
                                c.send(JSON.stringify(sentPayload));
                            }
                        });
                    }
                    if (newestSyncedTs > lastSyncedTs) {
                        lastSyncedMetaSentTsByJid.set(senderJid, newestSyncedTs);
                    }
                } catch (syncError) {
                    // console.warn(`Could not sync recent Meta AI sent messages: ${syncError.message}`);
                }
            };
            const syncRecentMetaReceivedMessages = async () => {
                if (senderJid !== '13135550002') {
                    return;
                }
                try {
                    const chatId = `${senderJid}@c.us`;
                    const recentMessages = await client.getAllMessagesInChat(chatId, true, false);
                    if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
                        return;
                    }

                    const lastSyncedTs = lastSyncedMetaReceivedTsByJid.get(senderJid) || 0;
                    let newestSyncedTs = lastSyncedTs;
                    const candidates = recentMessages
                        .slice(-120)
                        .filter((msgItem) => !msgItem?.fromMe && Number(msgItem?.t || 0) > lastSyncedTs)
                        .sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0));

                    for (const msgItem of candidates) {
                        const itemTsSeconds = Number(msgItem?.t || 0);
                        if (itemTsSeconds > newestSyncedTs) {
                            newestSyncedTs = itemTsSeconds;
                        }
                        const text = extractTextContent(msgItem);
                        if (!text) {
                            continue;
                        }
                        const msgId = getSerializedId(msgItem);
                        if (!msgId) {
                            continue;
                        }
                        const msgTimestamp = new Date(itemTsSeconds * 1000).toISOString();
                        const receivedMessage = {
                            id: msgId,
                            subType: 'chat',
                            content: text,
                            timestamp: msgTimestamp,
                            direction: 'received'
                        };

                        const inserted = await addMessageToChat(senderJid, receivedMessage);
                        if (!inserted) {
                            continue;
                        }

                        const metaContact = await getContactDetails(senderJid);
                        const receivedPayload = {
                            type: 'message',
                            subType: 'chat',
                            from: senderJid,
                            content: text,
                            timestamp: msgTimestamp,
                            direction: 'received',
                            contactName: metaContact.name,
                            contactProfilePicUrl: metaContact.profilePicUrl
                        };
                        wss.clients.forEach(c => {
                            if (c.readyState === WebSocket.OPEN) {
                                c.send(JSON.stringify(receivedPayload));
                            }
                        });
                    }
                    if (newestSyncedTs > lastSyncedTs) {
                        lastSyncedMetaReceivedTsByJid.set(senderJid, newestSyncedTs);
                    }
                } catch (syncError) {
                    // console.warn(`Could not sync recent Meta AI received messages: ${syncError.message}`);
                }
            };

            const shouldRunMetaReceivedBackfill = senderJid === '13135550002' && !message.fromMe;
            // Temporarily disable Meta AI sync to prevent message flooding
            // await syncRecentMetaSentMessages();

            // Handle media messages (image, sticker, document, video, audio)
            if (isLikelyMediaMessage) {
                try {
                    // Use full media download to avoid thumbnails
                    const mediaData = await client.downloadMedia(message);
                    if (typeof mediaData === 'string') {
                        messageForDb.content = mediaData.includes(',') ? mediaData.split(',').pop() : mediaData;
                    } else if (Buffer.isBuffer(mediaData)) {
                        messageForDb.content = mediaData.toString('base64');
                    }
                    messageForDb.subType = message.type === 'ptt' ? 'audio' : message.type;
                    messageForDb.mimetype = message.mimetype;
                } catch (e) {
                    // console.error(`Error processing media message (ID: ${message.id}, Type: ${message.type}):`, e);
                    messageForDb.content = '[Error processing media]';
                    messageForDb.subType = 'chat'; // Fallback to chat type for display
                }
            } else {
                let content = extractTextContent(message);

                // For Meta AI / bot messages, try to get the full content directly
                if (!content || content.length < 20) {
                    try {
                        const fullMessage = await client.getMessageById(message.id);
                        if (fullMessage) {
                            const extracted = extractTextContent(fullMessage);
                            if (extracted && extracted.length > content.length) {
                                content = extracted;
                            }
                        }
                    } catch (e) {
                        // Continue with existing content
                    }
                }

                const shouldDeepResolve =
                    !content ||
                    content.length <= 8 ||
                    (senderJid === '13135550002' && !message.fromMe && content.length <= 120) ||
                    Boolean(message.botResponseTargetId || message.parentMsgId || message.invokedBotWid || message.botPluginType);

                const resolveMessageByRef = async (refId) => {
                    const normalizedRefId = typeof refId === 'string' ? refId.trim() : '';
                    if (!normalizedRefId) {
                        return null;
                    }

                    const candidateIds = [];
                    const addCandidate = (id) => {
                        if (typeof id === 'string' && id.trim() && !candidateIds.includes(id.trim())) {
                            candidateIds.push(id.trim());
                        }
                    };

                    addCandidate(normalizedRefId);

                    const remoteJids = [message.from, message.to, message.invokedBotWid, `${senderJid}@c.us`]
                        .filter((jid) => typeof jid === 'string' && jid.includes('@'));

                    // Build full serialized IDs from key fragments like "AC45FBC...".
                    for (const remote of remoteJids) {
                        addCandidate(`false_${remote}_${normalizedRefId}`);
                        addCandidate(`true_${remote}_${normalizedRefId}`);
                    }

                    const idParts = typeof message.id === 'string' ? message.id.split('_') : [];
                    if (idParts.length >= 3) {
                        const boolFlag = idParts[0];
                        const remote = idParts[1];
                        addCandidate(`${boolFlag}_${remote}_${normalizedRefId}`);
                        addCandidate(`${boolFlag === 'true' ? 'false' : 'true'}_${remote}_${normalizedRefId}`);
                    }

                    for (const candidateId of candidateIds) {
                        try {
                            const resolved = await client.getMessageById(candidateId);
                            if (resolved) {
                                return resolved;
                            }
                        } catch (error) {
                            // Continue trying alternate candidate IDs.
                        }
                    }
                    return null;
                };

                const resolveFromRecentChatMessages = async () => {
                    try {
                        const chatId = `${senderJid}@c.us`;
                        const recentMessages = await client.getAllMessagesInChat(chatId, true, false);
                        if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
                            return '';
                        }

                        const currentMessageId = getSerializedId(message);
                        const tail = currentMessageId ? currentMessageId.split('_').pop() : '';
                        const currentTs = Number(message.t || 0);
                        const scored = [];

                        for (const msgItem of recentMessages.slice(-80)) {
                            const text = extractTextContent(msgItem);
                            if (!text) {
                                continue;
                            }
                            const itemId = getSerializedId(msgItem);
                            const itemTail = itemId ? itemId.split('_').pop() : '';
                            const itemTs = Number(msgItem?.t || 0);

                            let score = text.length;
                            if (itemId && currentMessageId && itemId === currentMessageId) score += 2000;
                            if (tail && itemTail && tail === itemTail) score += 1500;
                            if (currentTs && itemTs && Math.abs(itemTs - currentTs) <= 3) score += 800;
                            if (currentTs && itemTs && Math.abs(itemTs - currentTs) <= 10) score += 300;
                            if (msgItem?.from === message.from) score += 50;

                            scored.push({ score, text });
                        }

                        if (!scored.length) {
                            return '';
                        }

                        scored.sort((a, b) => b.score - a.score);
                        return scored[0].text || '';
                    } catch (recentError) {
                        // console.warn(`Could not resolve from recent chat messages for ${message.id}: ${recentError.message}`);
                        return '';
                    }
                };
                const resolveLongerRecentMetaReceived = async (currentContent) => {
                    try {
                        if (senderJid !== '13135550002' || message.fromMe) {
                            return '';
                        }
                        const chatId = `${senderJid}@c.us`;
                        const recentMessages = await client.getAllMessagesInChat(chatId, true, false);
                        if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
                            return '';
                        }
                        const currentTs = Number(message.t || 0);
                        const minLen = typeof currentContent === 'string' ? currentContent.length : 0;
                        let best = '';
                        for (const msgItem of recentMessages.slice(-120)) {
                            if (msgItem?.fromMe) continue;
                            const text = extractTextContent(msgItem);
                            if (!text || text.length <= minLen) continue;
                            const itemTs = Number(msgItem?.t || 0);
                            if (currentTs && itemTs && Math.abs(itemTs - currentTs) > 20) continue;
                            if (text.length > best.length) best = text;
                        }
                        return best;
                    } catch (recentError) {
                        // console.warn(`Could not resolve longer recent Meta reply for ${message.id}: ${recentError.message}`);
                        return '';
                    }
                };

                if (shouldDeepResolve) {
                    try {
                        const refreshedMessage = await client.getMessageById(message.id);
                        const refreshedContent = extractTextContent(refreshedMessage);
                        if (refreshedContent && (!content || refreshedContent.length > content.length)) {
                            content = refreshedContent;
                        }
                    } catch (refreshError) {
                        // console.warn(`Could not refresh message content for ${message.id}: ${refreshError.message}`);
                    }
                }

                if (!content) {
                    const referenceIds = [message.botResponseTargetId, message.parentMsgId]
                        .filter((id, index, arr) => typeof id === 'string' && id.trim() && arr.indexOf(id) === index);
                    for (const refId of referenceIds) {
                        try {
                            const referencedMessage = await resolveMessageByRef(refId);
                            if (!referencedMessage) {
                                continue;
                            }
                            const referencedContent = extractTextContent(referencedMessage);
                            if (!referencedContent) {
                                continue;
                            }

                            const referencedJid = referencedMessage?.fromMe
                                ? (toJidPart(referencedMessage.to) || senderJid)
                                : (toJidPart(referencedMessage.from) || senderJid);
                            const referencedTimestamp = referencedMessage?.t
                                ? new Date(referencedMessage.t * 1000).toISOString()
                                : timestamp;
                            const referencedDirection = referencedMessage?.fromMe ? 'sent' : 'received';
                            const recoveredMessage = {
                                id: referencedMessage?.id || refId,
                                subType: 'chat',
                                content: referencedContent,
                                timestamp: referencedTimestamp,
                                direction: referencedDirection
                            };

                            const inserted = await addMessageToChat(referencedJid, recoveredMessage);
                            if (inserted) {
                                const recoveredContact = await getContactDetails(referencedJid);
                                const recoveredPayload = {
                                    type: 'message',
                                    subType: 'chat',
                                    from: referencedJid,
                                    content: referencedContent,
                                    timestamp: referencedTimestamp,
                                    direction: referencedDirection,
                                    contactName: recoveredContact.name,
                                    contactProfilePicUrl: recoveredContact.profilePicUrl
                                };
                                wss.clients.forEach(c => {
                                    if (c.readyState === WebSocket.OPEN) {
                                        c.send(JSON.stringify(recoveredPayload));
                                    }
                                });
                            }
                            return;
                        } catch (relatedError) {
                            // console.warn(`Could not resolve related bot message ${refId}: ${relatedError.message}`);
                        }
                    }

                    // console.log('Empty text message payload:', {
                    //     from: message.from,
                    //     type: message.type,
                    //     id: message.id,
                    //     keys: Object.keys(message).slice(0, 50)
                    // });
                    if (message.type === 'rich_response') {
                        const safe = JSON.stringify(message, (k, v) => {
                            if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '...';
                            return v;
                        }, 2);
                        // console.log('rich_response raw (truncated):', safe.slice(0, 4000));
                    }
                    // Skip non-media system events that do not contain user-readable text.
                    return;
                }

                // Meta AI / bot payloads can arrive as short placeholders in onMessage.
                // If we can resolve a richer related payload, prefer it.
                if (content.length <= 8 && (message.botResponseTargetId || message.parentMsgId)) {
                    const extraReferenceIds = [message.botResponseTargetId, message.parentMsgId]
                        .filter((id, index, arr) => typeof id === 'string' && id.trim() && arr.indexOf(id) === index);
                    for (const refId of extraReferenceIds) {
                        try {
                            const referencedMessage = await resolveMessageByRef(refId);
                            if (!referencedMessage) {
                                continue;
                            }
                            const referencedContent = extractTextContent(referencedMessage);
                            if (referencedContent && referencedContent.length > content.length) {
                                content = referencedContent;
                            }
                        } catch (relatedError) {
                            // console.warn(`Could not refine short content from ${refId}: ${relatedError.message}`);
                        }
                    }
                }

                if (content.length <= 120 && senderJid === '13135550002' && !message.fromMe) {
                    const recentResolved = await resolveFromRecentChatMessages();
                    if (recentResolved && recentResolved.length > content.length) {
                        content = recentResolved;
                    }
                    const longerRecent = await resolveLongerRecentMetaReceived(content);
                    if (longerRecent && longerRecent.length > content.length) {
                        content = longerRecent;
                    }
                    if (content.length <= 20) {
                        // console.log('Meta AI short-content debug:', {
                        //     id: message.id,
                        //     from: message.from,
                        //     to: message.to,
                        //     body: message.body,
                        //     text: message.text,
                        //     content: message.content,
                        //     botResponseTargetId: message.botResponseTargetId,
                        //     parentMsgId: message.parentMsgId,
                        //     invokedBotWid: message.invokedBotWid,
                        //     botPluginType: message.botPluginType,
                        //     bizBotType: message.bizBotType
                        // });
                    }
                }

                messageForDb.content = content;
                messageForDb.subType = 'chat';
            }
            
            Object.assign(payloadForWs, {
                subType: messageForDb.subType,
                content: messageForDb.content,
                mimetype: messageForDb.mimetype
            });

            const inserted = await addMessageToChat(senderJid, messageForDb);
            if (!inserted) {
                if (shouldRunMetaReceivedBackfill) {
                    await syncRecentMetaReceivedMessages();
                }
                return;
            }

            const contactDetails = await getContactDetails(senderJid);
            const senderProfile = message?.sender?.profilePicThumbObj;
            if (senderProfile && (senderProfile.imgFull || senderProfile.eurl || senderProfile.img)) {
                contactDetails.profilePicUrl = senderProfile.imgFull || senderProfile.eurl || senderProfile.img;
            }
            Object.assign(payloadForWs, {
                contactName: contactDetails.name,
                contactProfilePicUrl: contactDetails.profilePicUrl
            });

            wss.clients.forEach(c => c.send(JSON.stringify(payloadForWs)));
            
            // Sync sent messages from phone when a message is received
            await syncSentMessagesForChat(senderJid);

            if (messageForDb.subType === 'chat') {
                const chatMode = await getChatMode(senderJid);
                // console.log(`Chat mode for ${senderJid} is '${chatMode}'.`);

                const hasContent = messageForDb.content && messageForDb.content.trim().length > 0;
                
                if (chatMode === 'C' && messageForDb.direction === 'received' && hasContent) {
                    // console.log(`Auto-replying to ${senderJid}...`);
                    // console.log('Original message structure:', { 
                    //     from: message.from, 
                    //     fromType: typeof message.from, 
                    //     senderJid: senderJid,
                    //     messageKeys: Object.keys(message)
                    // });
                    try {
                        const instruction = await getAIInstruction();
                        // console.log('Full AI instruction length:', instruction.length);
                        // console.log('AI instruction preview:', instruction.substring(0, 200) + '...');
                        
                        // Check last chat time for self-introduction
                        const state = await readState();
                        const lastChat = state.lastChatTime?.[senderJid];
                        const now = Date.now();
                        const HOURS_3 = 3 * 60 * 60 * 1000; // 3 hours in ms
                        const shouldIntroduce = !lastChat || (now - new Date(lastChat).getTime()) > HOURS_3;
                        
                        const apiKey = await getStoredApiKey();
                        let aiReplyText = await getAIReply(messageForDb.content, instruction, apiKey);
                        // console.log(`AI reply generated: "${aiReplyText}"`);
                        // console.log(`message.from (where to send): ${message.from}`);
                        // console.log(`senderJid: ${senderJid}`);
                        // console.log(`message.fromMe: ${message.fromMe}`);
                        // console.log(`shouldIntroduce: ${shouldIntroduce}, lastChat: ${lastChat}`);
                        
                        // Add self-introduction if needed (gap > 3 hours)
                        if (shouldIntroduce) {
                            const hour = new Date().getHours();
                            const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
                            const intro = `${greeting}. This is Ava, Personal Assistant to Mr. Rupesh Kumar. `;
                            
                            // Prepend introduction if not already present
                            if (!aiReplyText.toLowerCase().startsWith('good') || !aiReplyText.includes('Ava')) {
                                aiReplyText = intro + aiReplyText;
                            }
                            
                            // Update last chat time
                            state.lastChatTime = state.lastChatTime || {};
                            state.lastChatTime[senderJid] = new Date().toISOString();
                            await writeState(state);
                        }
                        
                        await client.sendText(message.from, aiReplyText);
                        
                        // Store and broadcast AI reply immediately since Meta AI sync is disabled
                        const aiTimestamp = new Date().toISOString();
                        const aiMessageForDb = {
                            id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            subType: 'chat',
                            content: aiReplyText,
                            timestamp: aiTimestamp,
                            direction: 'sent'
                        };
                        
                        const aiContactDetails = await getContactDetails(senderJid);
                        const aiPayloadForWs = {
                            type: 'message',
                            from: senderJid, // Use consistent JID format
                            subType: 'chat',
                            content: aiReplyText,
                            timestamp: aiTimestamp,
                            direction: 'sent',
                            contactName: aiContactDetails.name,
                            contactProfilePicUrl: aiContactDetails.profilePicUrl,
                            id: aiMessageForDb.id
                        };
                        
                        // Store in database - IMPORTANT: Store with correct chat JID as the key
                        // Use the same JID extraction logic as the original message
                        const chatJidForStorage = senderJid;
                        await addMessageToChat(chatJidForStorage, aiMessageForDb);
                        
                        // Broadcast to all connected clients
                        wss.clients.forEach(c => {
                            if (c.readyState === WebSocket.OPEN) {
                                c.send(JSON.stringify(aiPayloadForWs));
                            }
                        });
                        
                        // console.log('AI reply sent and broadcasted to frontend');

                    } catch (error) {
                        // console.error('Auto-reply failed:', error.message);
                        // console.error('Stack trace:', error.stack);
                    }
                }
            }

            // Temporarily disable Meta AI sync to prevent message flooding
            /*
            if (shouldRunMetaReceivedBackfill) {
                await syncRecentMetaReceivedMessages();
            }
            */
        });
    })
    .catch((error) => {
        // console.error('Error starting WPPConnect:', error);
    });
    
    // Periodic sync for sent messages from phone
    const lastSentSyncByChat = new Map();
    setInterval(async () => {
        // console.log('[SentSync] Checking - wppClient:', !!wppClient, 'wppStatus:', wppStatus);
        if (!wppClient || wppStatus !== 'isLogged') {
            // console.log('[SentSync] Skipping - not ready');
            return;
        }
        
        try {
            // console.log('[SentSync] Running sync...');
            const chats = await wppClient.getAllChats();
            // console.log('[SentSync] Got chats:', chats?.length || 0);
            // Sync from all chats, not just recent ones
            const recentChats = chats.slice(0, 20);
            // console.log('[SentSync] Syncing from chats:', recentChats.length);
            
            for (const chat of recentChats) {
                const chatId = chat.id._serialized || chat.id;
                const jid = chatId.replace('@c.us', '').replace('@g.us', '');
                
                try {
                    const messages = await wppClient.getAllMessagesInChat(chatId, true, false);
                    if (!messages?.length) continue;
                    
                    const lastSync = lastSentSyncByChat.get(jid) || 0;
                    const lastSyncSec = Math.floor(lastSync / 1000);
                    const newSent = messages
                        .filter(m => m.fromMe && m.t > lastSyncSec)
                        .sort((a, b) => a.t - b.t);
                    
                    // console.log(`[SentSync] Chat ${jid}: lastSync=${lastSync}, messages=${messages.length}, newSent=${newSent.length}`);
                    
                    for (const msg of newSent) {
                        const content = msg.body || msg.caption || '';
                        if (!content) continue;
                        
                        const msgId = msg.id?._serialized || msg.id;
                        const msgTimestamp = new Date(msg.t * 1000).toISOString();
                        
                        const sentMessage = {
                            id: msgId,
                            subType: msg.type === 'ptt' ? 'audio' : (msg.type || 'chat'),
                            content: content,
                            timestamp: msgTimestamp,
                            direction: 'sent'
                        };
                        
                        const inserted = await addMessageToChat(jid, sentMessage);
                        if (inserted) {
                            const contact = await getContactDetails(jid);
                            const payload = {
                                type: 'message',
                                subType: sentMessage.subType,
                                from: jid,
                                content: content,
                                timestamp: msgTimestamp,
                                direction: 'sent',
                                contactName: contact.name,
                                contactProfilePicUrl: contact.profilePicUrl
                            };
                            wss.clients.forEach(c => {
                                if (c.readyState === WebSocket.OPEN) {
                                    c.send(JSON.stringify(payload));
                                }
                            });
                        }
                    }
                    
                    if (newSent.length > 0) {
                        lastSentSyncByChat.set(jid, Date.now());
                    }
                } catch (e) {
                    // Skip individual chat errors
                }
            }
        } catch (e) {
            // console.warn('Sent message sync error:', e.message);
        }
    }, 5000);  // Check every 5 seconds as backup
}

// Sync function to call from frontend when opening a chat
async function syncSentMessagesForChat(jid) {
    if (!wppClient || wppStatus !== 'isLogged') return 0;
    
    try {
        const chatId = `${jid}@c.us`;
        const messages = await wppClient.getAllMessagesInChat(chatId, true, false);
        if (!messages?.length) return 0;
        
        const lastSync = lastSentSyncByChat.get(jid) || 0;
        const lastSyncSec = Math.floor(lastSync / 1000);
        const newSent = messages.filter(m => m.fromMe && m.t > lastSyncSec);
        
        let synced = 0;
        for (const msg of newSent) {
            const content = msg.body || msg.caption || '';
            if (!content) continue;
            
            const msgId = msg.id?._serialized || msg.id;
            const msgTimestamp = new Date(msg.t * 1000).toISOString();
            
            const sentMessage = {
                id: msgId,
                subType: msg.type === 'ptt' ? 'audio' : (msg.type || 'chat'),
                content: content,
                timestamp: msgTimestamp,
                direction: 'sent'
            };
            
            const inserted = await addMessageToChat(jid, sentMessage);
            if (inserted) {
                synced++;
                const contact = await getContactDetails(jid);
                const payload = {
                    type: 'message',
                    subType: sentMessage.subType,
                    from: jid,
                    content: content,
                    timestamp: msgTimestamp,
                    direction: 'sent',
                    contactName: contact.name,
                    contactProfilePicUrl: contact.profilePicUrl
                };
                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify(payload));
                    }
                });
            }
        }
        
        if (newSent.length > 0) {
            lastSentSyncByChat.set(jid, Date.now());
        }
        
        return synced;
    } catch (e) {
        // console.warn('[SentSync] Error:', e.message);
        return 0;
    }
}

// API endpoint to sync when opening a chat
app.post('/api/sync-chat/:jid', async (req, res) => {
    const jid = req.params.jid;
    const synced = await syncSentMessagesForChat(jid);
    res.json({ synced });
});

server.listen(PORT, () => {
    // console.log(`Server is running on http://localhost:${PORT}`);
    startWPPConnect();
});


