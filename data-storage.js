const fs = require('fs').promises;
const path = require('path');

const CHATS_FILE_PATH = path.join(__dirname, 'chats.json');
const STATE_FILE_PATH = path.join(__dirname, 'state.json');

/**
 * @typedef {object} Message
 * @property {string} id - The message ID
 * @property {string} text - The message content
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {'sent' | 'received'} direction - 'sent' for outgoing, 'received' for incoming
 */

/**
 * @typedef {object.<string, Message[]>} Chats
 */

/**
 * Reads all chats from the JSON file.
 * @returns {Promise<Chats>}
 */
async function readChats() {
    try {
        await fs.access(CHATS_FILE_PATH);
        const data = await fs.readFile(CHATS_FILE_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        console.error('Error reading chats.json:', error);
        return {};
    }
}

/**
 * Writes chats to the JSON file.
 * @param {Chats} chatsData
 */
async function writeChats(chatsData) {
    try {
        const jsonString = JSON.stringify(chatsData, null, 2);
        await fs.writeFile(CHATS_FILE_PATH, jsonString);
    } catch (error) {
        console.error('Error writing to chats.json:', error);
    }
}

/**
 * Adds a new message to a chat.
 * @param {string} jid - The JID of the chat contact.
 * @param {Message} message - The message object.
 */
async function getChatHistory(chatId, limit = 10) {
    try {
        const chats = await readChats();
        const chat = chats[chatId];
        if (chat && chat.messages) {
            return chat.messages
                .filter(msg => msg.subType === 'chat') // Only text messages
                .slice(-limit); // Last N messages
        }
        return [];
    } catch (error) {
        console.error('Error getting chat history:', error);
        return [];
    }
}

async function addMessageToChat(jid, message) {
    const chats = await readChats();
    if (!chats[jid]) {
        chats[jid] = [];
    }
    if (message && message.id && chats[jid].some((m) => m.id === message.id)) {
        return false;
    }
    const msgContent = typeof message?.content === 'string' ? message.content.trim() : '';
    const msgDirection = message?.direction || '';
    const msgSubType = message?.subType || 'chat';
    const msgTs = Date.parse(message?.timestamp || '');
    if (msgContent && Number.isFinite(msgTs)) {
        const duplicateByContent = chats[jid].some((m) => {
            const existingContent = typeof m?.content === 'string' ? m.content.trim() : '';
            const existingDirection = m?.direction || '';
            const existingSubType = m?.subType || 'chat';
            const existingTs = Date.parse(m?.timestamp || '');
            if (!existingContent || !Number.isFinite(existingTs)) return false;
            if (existingDirection !== msgDirection) return false;
            if (existingSubType !== msgSubType) return false;
            if (existingContent !== msgContent) return false;
            // Guard against same message entering once from optimistic local send and once from WA echo.
            return Math.abs(existingTs - msgTs) <= 8000;
        });
        if (duplicateByContent) {
            return false;
        }
    }
    chats[jid].push(message);
    await writeChats(chats);
    return true;
}

/**
 * @typedef {object} AppState
 * @property {object.<string, string>} chatModes - Mapping of JID to mode ('A', 'B', 'C')
 * @property {string} aiInstruction - Global instruction for AI in auto mode
 */

/**
 * Reads the entire application state from the JSON file.
 * @returns {Promise<AppState>}
 */
async function readState() {
    let state = { chatModes: {}, aiInstruction: process.env.AI_INSTRUCTION || "You are a helpful and friendly assistant." };
    try {
        await fs.access(STATE_FILE_PATH);
        const data = await fs.readFile(STATE_FILE_PATH, 'utf-8');
        const parsedState = JSON.parse(data);
        // Merge with defaults to ensure all properties exist
        state = { ...state, ...parsedState };
        // Ensure chatModes is an object
        if (typeof state.chatModes !== 'object' || state.chatModes === null) {
            state.chatModes = {};
        }
    } catch (error) {
        if (error.code !== 'ENOENT') { // Log error if it's not just "file not found"
            console.error('Error reading state.json:', error);
        }
        // If file doesn't exist or is malformed, the default `state` object will be returned.
    }
    return state;
}

/**
 * Writes the entire application state to the JSON file.
 * @param {AppState} stateData
 */
async function writeState(stateData) {
    try {
        await fs.writeFile(STATE_FILE_PATH, JSON.stringify(stateData, null, 2));
    } catch (error) {
        console.error('Error writing to state.json:', error);
    }
}

/**
 * Gets the interaction mode for a specific chat.
 * @param {string} jid The JID of the chat.
 * @returns {Promise<string>} The mode ('A', 'B', or 'C'). Defaults to 'A' (Manual).
 */
async function getChatMode(jid) {
    const state = await readState();
    return state.chatModes[jid] || 'A'; // Default to 'A' (Manual)
}

/**
 * Sets the interaction mode for a specific chat.
 * @param {string} jid The JID of the chat.
 * @param {string} mode The mode to set ('A', 'B', or 'C').
 */
async function setChatMode(jid, mode) {
    const state = await readState();
    state.chatModes[jid] = mode;
    await writeState(state);
}

/**
 * Gets the dynamic AI instruction based on user settings.
 * @returns {Promise<string>} The AI instruction.
 */
async function getAIInstruction() {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '.env');
    
    // Default generic instruction
    const DEFAULT_INSTRUCTION = "You are Ava, an AI assistant. Respond professionally, politely, and concisely.";
    
    let aiTraining = '';
    let aiSchedule = '';
    
    try {
        const envContent = await fs.promises.readFile(envPath, 'utf-8');
        const lines = envContent.split('\n');
        lines.forEach(line => {
            if (line.startsWith('AI_TRAINING=')) {
                aiTraining = line.substring('AI_TRAINING=').replace(/"/g, '').trim();
            }
            if (line.startsWith('AI_SCHEDULE=')) {
                aiSchedule = line.substring('AI_SCHEDULE=').replace(/"/g, '').trim();
            }
        });
    } catch (error) {
        console.error('Error reading settings:', error);
    }
    
    // Use user training or default instruction
    let baseInstruction = DEFAULT_INSTRUCTION;
    if (aiTraining) {
        baseInstruction = aiTraining;
    }
    
    // If no schedule, return just the instruction without schedule context
    if (!aiSchedule) {
        return baseInstruction;
    }
    
    // Add schedule context
    const now = new Date();
    const currentTime = now.toTimeString('en-US', { hour: '2-digit', hour12: false, minute: '2-digit' });
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
    
    let scheduleContext = `\n\nCurrent Context: Today is ${currentDay}. Current time is ${currentTime}.`;
    
    // Parse schedule and determine current activity
    const scheduleLines = aiSchedule.split('\n');
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    
    let currentActivity = 'Available';
    
    for (const line of scheduleLines) {
        const trimmedLine = line.trim();
        if (trimmedLine && trimmedLine.includes(':')) {
            const parts = trimmedLine.split(':');
            if (parts.length >= 2) {
                const timeRange = parts[0].trim();
                const activity = parts.slice(1).join(':').trim();
                
                // Parse time ranges like "6:00-7:00" (24-hour format)
                const timeMatch = timeRange.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
                if (timeMatch) {
                    const startTime = timeMatch[1];
                    const endTime = timeMatch[2];
                    
                    const startMinutes = convert24HourTimeToMinutes(startTime);
                    const endMinutes = convert24HourTimeToMinutes(endTime);
                    
                    if (currentTimeInMinutes >= startMinutes && currentTimeInMinutes <= endMinutes) {
                        currentActivity = activity;
                    }
                }
                
                scheduleContext += ` ${timeRange}: ${activity}. `;
            }
        }
    }
    
    scheduleContext += `\n\nCurrent Status: Currently ${currentActivity}.`;
    
    // Add specific guidance based on activity
    if (currentActivity.includes('Study') || currentActivity.includes('Homework') || currentActivity.includes('Programming') || currentActivity.includes('Coding')) {
        scheduleContext += ' The user is busy. Tell when they will be free. Ask if urgent.';
    } else if (currentActivity.includes('School')) {
        scheduleContext += ' The user is at school. Will reply later.';
    } else if (currentActivity.includes('Sleep')) {
        scheduleContext += ' The user is sleeping. Will reply in the morning.';
    } else {
        scheduleContext += ' The user is available.';
    }
    
    function convert24HourTimeToMinutes(timeStr) {
        const match = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (!match) return 0;
        
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        
        return hours * 60 + minutes;
    }
    
    return baseInstruction + scheduleContext;
}

/**
 * Sets the global AI instruction.
 * @param {string} instruction The new AI instruction.
 */
async function setAIInstruction(instruction) {
    const state = await readState();
    state.aiInstruction = instruction;
    await writeState(state);
}

/**
 * Deletes a message from a chat.
 * @param {string} chatId - The chat JID
 * @param {string} messageId - The message ID to delete
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteMessageFromChat(chatId, messageId) {
    try {
        const chats = await readChats();
        if (!chats[chatId] || !Array.isArray(chats[chatId])) {
            return false;
        }
        
        const initialLength = chats[chatId].length;
        chats[chatId] = chats[chatId].filter(msg => msg.id !== messageId);
        
        if (chats[chatId].length < initialLength) {
            await writeChats(chats);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting message:', error);
        return false;
    }
}

/**
 * Deletes a message from a chat using partial ID match.
 * @param {string} chatId - The chat JID
 * @param {string} messageId - The message ID to delete (partial match)
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteMessageFromChatPartial(chatId, messageId) {
    try {
        const chats = await readChats();
        if (!chats[chatId] || !Array.isArray(chats[chatId])) {
            return false;
        }
        
        const initialLength = chats[chatId].length;
        
        // Try to find a message where either ID contains the other
        chats[chatId] = chats[chatId].filter(msg => {
            // Skip if IDs match exactly
            if (msg.id === messageId) return false;
            // Check for partial matches (useful when message gets new ID after sending)
            const msgIdPart = msg.id.split('_').slice(1).join('_');
            const searchIdPart = messageId.split('_').slice(1).join('_');
            return !(msg.id.includes(searchIdPart) || messageId.includes(msgIdPart));
        });
        
        if (chats[chatId].length < initialLength) {
            await writeChats(chats);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting message (partial):', error);
        return false;
    }
}


/**
 * Deletes an entire chat.
 * @param {string} chatId - The chat JID
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteChat(chatId) {
    try {
        const chats = await readChats();
        if (!chats[chatId]) {
            return false;
        }
        
        delete chats[chatId];
        await writeChats(chats);
        return true;
    } catch (error) {
        console.error('Error deleting chat:', error);
        return false;
    }
}

module.exports = {
    readChats,
    writeChats,
    addMessageToChat,
    getChatHistory,
    getChatMode,
    setChatMode,
    getAIInstruction,
    setAIInstruction,
    readState,
    writeState,
    deleteMessageFromChat,
    deleteMessageFromChatPartial,
    deleteChat
};
