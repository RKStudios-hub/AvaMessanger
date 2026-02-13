document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const chatListView = document.getElementById('chat-list-view');
    const chatConversationView = document.getElementById('chat-conversation-view');
    const chatItemsContainer = document.getElementById('chat-items-container');
    const messageArea = document.getElementById('message-area');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const attachButton = document.getElementById('attach-button');
    const chatBackButton = document.getElementById('chat-back-button');
    const currentChatAvatarElement = document.getElementById('current-chat-avatar');
    const currentChatNameElement = document.getElementById('current-chat-name');
    const chatModeDropdown = document.getElementById('chat-mode-dropdown');
    const modeIndicator = document.getElementById('mode-indicator');
    const searchInput = document.querySelector('.search-box input');
    const scrollToBottomBtn = document.getElementById('scroll-to-bottom-btn');
    const syncContactsButton = document.getElementById('sync-contacts-button');
    const settingsButton = document.getElementById('settings-button');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings');
    const saveSettingsBtn = document.getElementById('save-settings');
    const groqApiKeyInput = document.getElementById('groq-api-key');
    const aiTrainingTextarea = document.getElementById('ai-training');
    const aiScheduleTextarea = document.getElementById('ai-schedule');
    const themeSelect = document.getElementById('theme-select');

    // --- App State ---
    let allChatsData = {};
    let activeChatJid = null;
    let socket = null;
    
    // Virtual scrolling state
    let visibleChatItems = [];
    let lastVisibleIndex = 0;
    const CHAT_ITEM_HEIGHT = 80; // Approximate height of each chat item
    const VISIBLE_BUFFER = 5; // Number of items to render above/below viewport
    
    // Pagination state
    let currentPage = 1;
    const PAGE_LIMIT = 50;
    let isLoadingMore = false;
    let hasMoreChats = true;
    
    // Settings state
    let appSettings = {
        groqApiKey: '',
        aiTraining: '',
        aiSchedule: ''
    };

    // --- WebSocket Connection ---
    function connectWebSocket() {
        try {
            const port = window.location.port || '3001';
            socket = new WebSocket(`ws://${window.location.hostname}:${port}`);
            
            socket.onopen = () => {
                console.log('Connected to WebSocket server');
                fetchInitialData();
            };

            socket.onclose = () => {
                console.log('Disconnected from WebSocket server');
                setTimeout(connectWebSocket, 3000);
            };

            socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                setTimeout(connectWebSocket, 3000);
            };

            socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'message') {
                    handleIncomingMessage(data);
                }
            };

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            setTimeout(connectWebSocket, 3000);
        }
    }

    // --- Data Handling ---
    async function fetchInitialData() {
        try {
            currentPage = 1;
            const response = await fetch(`/api/chats?page=1&limit=${PAGE_LIMIT}`);
            if (response.ok) {
                const data = await response.json();
                allChatsData = data.chats || {};
                hasMoreChats = data.pagination?.hasMore || false;
                
                // Ensure each chat has a messages array
                for (const jid in allChatsData) {
                    if (!allChatsData[jid].messages) {
                        allChatsData[jid].messages = [];
                    }
                }
                renderChatList();
            } else {
                console.error('Failed to fetch initial chat data');
            }
        } catch (error) {
            console.error('Error fetching initial data:', error);
        }
    }

    async function loadMoreChats() {
        if (isLoadingMore || !hasMoreChats) return;
        
        isLoadingMore = true;
        showLoadingIndicator();
        
        try {
            currentPage++;
            const response = await fetch(`/api/chats?page=${currentPage}&limit=${PAGE_LIMIT}`);
            if (response.ok) {
                const data = await response.json();
                
                // Merge new chats with existing data
                Object.assign(allChatsData, data.chats || {});
                hasMoreChats = data.pagination?.hasMore || false;
                
                renderChatList();
            } else {
                console.error('Failed to load more chats');
                currentPage--; // Reset page number on failure
            }
        } catch (error) {
            console.error('Error loading more chats:', error);
            currentPage--; // Reset page number on failure
        } finally {
            isLoadingMore = false;
            hideLoadingIndicator();
        }
    }

    function showLoadingIndicator() {
        const existingIndicator = document.getElementById('loading-indicator');
        if (existingIndicator) return;
        
        const indicator = document.createElement('div');
        indicator.id = 'loading-indicator';
        indicator.className = 'loading-indicator';
        indicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading more chats...';
        chatItemsContainer.appendChild(indicator);
    }

    function hideLoadingIndicator() {
        const indicator = document.getElementById('loading-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    function handleIncomingMessage(data) {
        console.log('Received message via WebSocket:', data);
        const { from, subType, content, mimetype, timestamp, direction, contactName, contactProfilePicUrl, id, isOriginalInSemiAI, isAIRewrite } = data;
        
        // Normalize JID format - remove all suffixes (@c.us, @g.us, @lid, etc)
        let remoteJid = from.replace(/@.*$/, '');

        const fallbackDp = getAvatarUrl(remoteJid);
        const dpUrl = contactProfilePicUrl || fallbackDp;
        const contactNm = contactName || remoteJid;
        
        if (!allChatsData[remoteJid]) {
            allChatsData[remoteJid] = { 
                messages: [], 
                contact: { 
                    name: contactNm, 
                    profilePicUrl: dpUrl 
                } 
            };
            console.log('Created new chat for:', remoteJid);
        } else {
            // Update contact info if provided
            if (contactName) {
                allChatsData[remoteJid].contact.name = contactNm;
            }
            if (contactProfilePicUrl) {
                allChatsData[remoteJid].contact.profilePicUrl = dpUrl;
            }
        }

        const messageData = {
            id: id || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            subType: subType,
            content: content,
            mimetype: mimetype,
            timestamp: timestamp,
            direction: direction || 'received',
            isOriginalInSemiAI: isOriginalInSemiAI || false,
            isAIRewrite: isAIRewrite || false
        };

        // Check for duplicate message by ID or similar recent message (within 2 seconds)
        const existingMessage = allChatsData[remoteJid].messages.find(msg => msg.id === id);
        if (existingMessage) {
            return; // Skip duplicate completely
        }
        
        // Also check for near-duplicates (same content within 2 seconds) for media
        const recentDuplicate = allChatsData[remoteJid].messages.find(msg => 
            msg.content === content && 
            msg.subType === subType &&
            Math.abs(new Date(msg.timestamp) - new Date(timestamp)) < 2000
        );
        if (recentDuplicate) {
            return; // Skip duplicate
        }

        allChatsData[remoteJid].messages.push(messageData);
        console.log('Message added to', remoteJid, 'Total messages:', allChatsData[remoteJid].messages.length);
        
        renderChatList();

        // Also normalize activeChatJid for comparison
        const normalizedActiveChat = activeChatJid ? activeChatJid.replace('@c.us', '').replace('@g.us', '') : null;
        console.log('Comparing:', remoteJid, '===', normalizedActiveChat, '=', remoteJid === normalizedActiveChat);
        
        if (remoteJid === normalizedActiveChat) {
            displayChat(remoteJid); // Refresh entire chat to maintain correct order
        }
    }

    function getAvatarUrl(seed) {
        const defaultSeed = seed || 'default';
        return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(defaultSeed)}`;
    }

    // --- Rendering Functions ---
    function renderChatList() {
        // Get sorted and filtered JIDs
        let sortedJids = Object.keys(allChatsData).sort((a, b) => {
            const lastMsgA = allChatsData[a]?.messages?.slice(-1)[0];
            const lastMsgB = allChatsData[b]?.messages?.slice(-1)[0];
            const timeA = lastMsgA ? new Date(lastMsgA.timestamp).getTime() : 0;
            const timeB = lastMsgB ? new Date(lastMsgB.timestamp).getTime() : 0;
            return timeB - timeA;
        });

        // Apply search filter
        const searchTerm = searchInput.value.toLowerCase().trim();
        if (searchTerm) {
            sortedJids = sortedJids.map(jid => {
                const chat = allChatsData[jid];
                const contactName = chat.contact?.name?.toLowerCase() || '';
                const lastMessage = chat.messages?.[chat.messages.length - 1];
                const lastMessageContent = lastMessage?.content?.toLowerCase() || '';
                
                // Calculate match score
                let score = 0;
                if (contactName.includes(searchTerm)) {
                    if (contactName === searchTerm) score = 100; // Exact name match
                    else if (contactName.startsWith(searchTerm)) score = 80; // Name starts with
                    else score = 50; // Name contains
                }
                if (lastMessageContent.includes(searchTerm)) {
                    score += 20; // Message content match
                }
                
                return { jid, score, chat, contactName, lastMessage };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score) // Sort by score (highest first)
            .map(item => item.jid);
        }

        // Calculate visible range for virtual scrolling
        const containerHeight = chatItemsContainer.clientHeight;
        const scrollTop = chatItemsContainer.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / CHAT_ITEM_HEIGHT) - VISIBLE_BUFFER);
        const endIndex = Math.min(sortedJids.length - 1, Math.ceil((scrollTop + containerHeight) / CHAT_ITEM_HEIGHT) + VISIBLE_BUFFER);

        // Clear container and set height for virtual scrolling
        chatItemsContainer.innerHTML = '';
        chatItemsContainer.style.height = `${containerHeight}px`;
        chatItemsContainer.style.overflowY = 'auto';

        // Create spacer for virtual scrolling
        const topSpacer = document.createElement('div');
        topSpacer.style.height = `${startIndex * CHAT_ITEM_HEIGHT}px`;
        chatItemsContainer.appendChild(topSpacer);

        // Render only visible items
        for (let i = startIndex; i <= endIndex && i < sortedJids.length; i++) {
            const jid = sortedJids[i];
            const chat = allChatsData[jid];
            if (!chat || !chat.messages) continue;

            const lastMessage = chat.messages[chat.messages.length - 1];
            const contactInfo = chat.contact;
            const previewText = lastMessage ? getMessagePreview(lastMessage) : 'New Chat';
            const chatTime = lastMessage ? new Date(lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            const chatItem = document.createElement('div');
            chatItem.classList.add('chat-item');
            chatItem.dataset.jid = jid;
            chatItem.style.height = `${CHAT_ITEM_HEIGHT}px`;
            chatItem.style.position = 'absolute';
            chatItem.style.top = `${i * CHAT_ITEM_HEIGHT}px`;
            chatItem.style.width = '100%';
            
            // Highlight matching text if searching
            let highlightedName = contactInfo.name;
            let highlightedPreview = previewText;
            
            if (searchTerm) {
                const nameLower = contactInfo.name.toLowerCase();
                const nameIndex = nameLower.indexOf(searchTerm);
                if (nameIndex !== -1) {
                    highlightedName = contactInfo.name.substring(0, nameIndex) + 
                        '<span class="search-highlight">' + 
                        contactInfo.name.substring(nameIndex, nameIndex + searchTerm.length) + 
                        '</span>' + 
                        contactInfo.name.substring(nameIndex + searchTerm.length);
                }
                
                const previewLower = previewText.toLowerCase();
                const previewIndex = previewLower.indexOf(searchTerm);
                if (previewIndex !== -1 && previewIndex < 50) {
                    highlightedPreview = previewText.substring(0, previewIndex) + 
                        '<span class="search-highlight">' + 
                        previewText.substring(previewIndex, previewIndex + searchTerm.length) + 
                        '</span>' + 
                        previewText.substring(previewIndex + searchTerm.length);
                }
            }
            
            chatItem.innerHTML = `
                <img data-src="${contactInfo.profilePicUrl}" alt="${contactInfo.name}" class="avatar" loading="lazy">
                <div class="chat-item-content">
                    <div class="chat-item-header">
                        <span class="chat-item-name">${highlightedName}</span>
                        <span class="chat-item-time">${chatTime}</span>
                    </div>
                    <p class="chat-item-last-message">${highlightedPreview}</p>
                </div>
                <button class="chat-delete-btn" title="Delete chat"><i class="fas fa-trash"></i></button>
            `;

            // Lazy load profile picture
            const avatar = chatItem.querySelector('.avatar');
            const isGroup = jid.includes('-') || jid.startsWith('12036');
            const fallbackUrl = isGroup 
                ? `https://ui-avatars.com/api/?name=${encodeURIComponent(jid)}&background=random&color=fff&size=128&bold=true`
                : getAvatarUrl(jid);
            avatar.onerror = () => { 
                avatar.src = fallbackUrl;
            };

            // Use Intersection Observer for lazy loading
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src && !img.src) {
                            img.src = img.dataset.src;
                            imageObserver.unobserve(img);
                        }
                    }
                });
            });

            imageObserver.observe(avatar);

            chatItem.addEventListener('click', () => showChatConversation(jid));
            
            // Delete button handler
            const deleteBtn = chatItem.querySelector('.chat-delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showDeleteChatModal(jid, contactInfo.name);
            });
            
            chatItemsContainer.appendChild(chatItem);
        }

        // Bottom spacer
        const bottomSpacer = document.createElement('div');
        bottomSpacer.style.height = `${(sortedJids.length - endIndex - 1) * CHAT_ITEM_HEIGHT}px`;
        chatItemsContainer.appendChild(bottomSpacer);
    }

    function getMessagePreview(lastMessage) {
        if (!lastMessage) return '';
        const type = lastMessage.subType || 'chat';
        const content = lastMessage.content || '';
        
        if (type === 'chat') {
            return content ? content.substring(0, 50) + (content.length > 50 ? '...' : '') : '';
        }
        if (type === 'image') return '📷 Photo';
        if (type === 'sticker') return '😀 Sticker';
        if (type === 'video') return '🎥 Video';
        if (type === 'audio' || type === 'ptt') return '🎵 Audio';
        if (type === 'document') return '📄 Document';
        return '[Media]';
    }

    function showChatConversation(jid) {
        // Normalize JID to match format in allChatsData
        activeChatJid = jid.replace(/@.*$/, '');
        const contactInfo = allChatsData[activeChatJid]?.contact || {
            name: jid, 
            profilePicUrl: getAvatarUrl(jid) 
        };
        
        // Truncate long names (like phone numbers) - show first 11 chars + "..."
        const displayName = contactInfo.name.length > 14 
            ? contactInfo.name.substring(0, 11) + '...' 
            : contactInfo.name;
        currentChatNameElement.textContent = displayName;
        currentChatAvatarElement.src = contactInfo.profilePicUrl;
        currentChatAvatarElement.onerror = () => { 
            currentChatAvatarElement.src = getAvatarUrl(activeChatJid); 
        };
        
        // Sync sent messages from phone when opening chat
        fetch(`/api/sync-chat/${activeChatJid}`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.synced > 0) {
                    console.log(`Synced ${data.synced} sent messages`);
                    displayChat(jid); // Refresh chat view
                }
            })
            .catch(err => console.error('Sync error:', err));

        loadChatMode(jid);
        displayChat(jid);
        switchView('chat-conversation-view');
    }

    function displayChat(jid) {
        messageArea.innerHTML = '';

        const messages = (allChatsData[jid]?.messages || [])
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        messages.forEach(msg => {
            appendMessage(msg.subType, msg.content, msg.mimetype, msg.direction, msg.timestamp, jid, msg.id, msg.isOriginalInSemiAI, msg.isAIRewrite);
        });
        
        requestAnimationFrame(() => {
            messageArea.scrollTop = messageArea.scrollHeight;
        });
    }
    
    // Scroll to bottom button functionality
    if (scrollToBottomBtn) {
        messageArea.addEventListener('scroll', () => {
            const isAtBottom = messageArea.scrollHeight - messageArea.scrollTop <= messageArea.clientHeight + 100;
            if (isAtBottom) {
                scrollToBottomBtn.classList.remove('show');
            } else {
                scrollToBottomBtn.classList.add('show');
            }
        });
        
        scrollToBottomBtn.addEventListener('click', () => {
            messageArea.scrollTo({
                top: messageArea.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    async function loadChatMode(jid) {
        try {
            const response = await fetch(`/api/mode/${jid}`);
            if (response.ok) {
                const data = await response.json();
                const mode = data.mode;
                
                const modeMap = {
                    'A': 'manual',
                    'B': 'semiai', 
                    'C': 'aiauto'
                };
                
                const mappedMode = modeMap[mode] || 'manual';
                chatModeDropdown.value = mappedMode;
                updateModeIndicator(mappedMode);
                updateCustomDropdown(mappedMode);
            }
        } catch (error) {
            console.error('Error loading chat mode:', error);
            chatModeDropdown.value = 'manual';
            updateModeIndicator('manual');
            updateCustomDropdown('manual');
        }
    }

    function updateModeIndicator(mode) {
        const modeIcons = {
            'manual': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12"><path fill="currentColor" d="M416 208C416 305.2 330 384 224 384C197.3 384 171.9 379 148.8 370L67.2 413.2C57.9 418.1 46.5 416.4 39 409C31.5 401.6 29.8 390.1 34.8 380.8L70.4 313.6C46.3 284.2 32 247.6 32 208C32 110.8 118 32 224 32C330 32 416 110.8 416 208zM416 576C321.9 576 243.6 513.9 227.2 432C347.2 430.5 451.5 345.1 463 229.3C546.3 248.5 608 317.6 608 400C608 439.6 593.7 476.2 569.6 505.6L605.2 572.8C610.1 582.1 608.4 593.5 601 601C593.6 608.5 582.1 610.2 572.8 605.2L491.2 562C468.1 571 442.7 576 416 576z"/></svg> Manual`,
            'semiai': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12"><path fill="currentColor" d="M184 120C184 89.1 209.1 64 240 64L264 64C281.7 64 296 78.3 296 96L296 544C296 561.7 281.7 576 264 576L232 576C202.2 576 177.1 555.6 170 528C169.3 528 168.7 528 168 528C123.8 528 88 492.2 88 448C88 430 94 413.4 104 400C84.6 385.4 72 362.2 72 336C72 305.1 89.6 278.2 115.2 264.9C108.1 252.9 104 238.9 104 224C104 179.8 139.8 144 184 144L184 120zM456 120L456 144C500.2 144 536 179.8 536 224C536 239 531.9 253 524.8 264.9C550.5 278.2 568 305 568 336C568 362.2 555.4 385.4 536 400C546 413.4 552 430 552 448C552 492.2 516.2 528 472 528C471.3 528 470.7 528 470 528C462.9 555.6 437.8 576 408 576L376 576C358.3 576 344 561.7 344 544L344 96C344 78.3 358.3 64 376 64L400 64C430.9 64 456 89.1 456 120z"/></svg> SemiAI`,
            'aiauto': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12"><path fill="currentColor" d="M352 64C352 46.3 337.7 32 320 32C302.3 32 288 46.3 288 64L288 128L192 128C139 128 96 171 96 224L96 448C96 501 139 544 192 544L448 544C501 544 544 501 544 448L544 224C544 171 501 128 448 128L352 128L352 64zM160 432C160 418.7 170.7 408 184 408L216 408C229.3 408 240 418.7 240 432C240 445.3 229.3 456 216 456L184 456C170.7 456 160 445.3 160 432zM280 432C280 418.7 290.7 408 304 408L336 408C349.3 408 360 418.7 360 432C360 445.3 349.3 456 336 456L304 456C290.7 456 280 445.3 280 432zM400 432C400 418.7 410.7 408 424 408L456 408C469.3 408 480 418.7 480 432C480 445.3 469.3 456 456 456L424 456C410.7 456 400 445.3 400 432zM224 240C250.5 240 272 261.5 272 288C272 314.5 250.5 336 224 336C197.5 336 176 314.5 176 288C176 261.5 197.5 240 224 240zM368 288C368 261.5 389.5 240 416 240C442.5 240 464 261.5 464 288C464 314.5 442.5 336 416 336C389.5 336 368 314.5 368 288zM64 288C64 270.3 49.7 256 32 256C14.3 256 0 270.3 0 288L0 384C0 401.7 14.3 416 32 416C49.7 416 64 401.7 64 384L64 288zM608 256C590.3 256 576 270.3 576 288L576 384C576 401.7 590.3 416 608 416C625.7 416 640 401.7 640 384L640 288C640 270.3 625.7 256 608 256z"/></svg> AutoAI`
        };
        
        modeIndicator.classList.remove('aiauto', 'semiai', 'manual');
        modeIndicator.classList.add(mode);
        modeIndicator.innerHTML = modeIcons[mode] || modeIcons['manual'];
    }

    // --- Message Append Function ---
    function appendMessage(subType, content, mimetype, direction, timestamp, senderJid, messageId, isOriginalInSemiAI = false, isAIRewrite = false) {
        const messageGroup = document.createElement('div');
        messageGroup.classList.add('message-group', direction);
        if (isOriginalInSemiAI) {
            messageGroup.classList.add('original-semi-ai');
        }
        if (isAIRewrite) {
            messageGroup.classList.add('ai-rewrite');
        }
        messageGroup.setAttribute('data-message-id', messageId);

        if (direction === 'received' && senderJid) {
            const avatar = document.createElement('img');
            avatar.classList.add('avatar', 'message-avatar');
            avatar.src = allChatsData[senderJid]?.contact?.profilePicUrl || getAvatarUrl(senderJid);
            avatar.alt = allChatsData[senderJid]?.contact?.name || 'Avatar';
            messageGroup.appendChild(avatar);
        }

        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble');

        if (subType === 'audio' || subType === 'ptt') {
            messageBubble.classList.add('audio-message');
            messageBubble.innerHTML = `
                <i class="fas fa-play"></i>
                <span class="audio-duration">${new Date(timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}</span>
            `;
        } else if (subType === 'image' || subType === 'sticker') {
            if (content && content.startsWith('UklGR')) {
                messageBubble.innerHTML = `
                    <img src="data:image/webp;base64,${content}" alt="Sticker" style="max-width: 150px; max-height: 150px; border-radius: 8px;" onerror="this.parentElement.innerHTML='<div class=\\'media-placeholder\\'><i class=\\'fas fa-image\\'></i> Failed to load</div>';">
                `;
            } else if (content && (content.includes('/') || content.includes('+') || content.length > 100)) {
                const mimeType = mimetype || 'image/jpeg';
                let imageSrc;
                
                if (content.startsWith('data:')) {
                    imageSrc = content;
                } else {
                    imageSrc = `data:${mimeType};base64,${content}`;
                }
                
                messageBubble.innerHTML = `
                    <img src="${imageSrc}" alt="Image" style="max-width: 200px; max-height: 200px; border-radius: 8px; cursor: pointer;" onclick="this.style.maxWidth='90vw'; this.style.maxHeight='70vh';" onerror="this.parentElement.innerHTML='<div class=\\'media-placeholder\\'><i class=\\'fas fa-image\\'></i> Failed to load</div>';">
                `;
            } else {
                messageBubble.innerHTML = `
                    <div class="media-placeholder">
                        <i class="fas fa-image"></i> ${subType === 'sticker' ? 'Sticker' : 'Image'}
                    </div>
                `;
            }
        } else if (subType === 'video') {
            messageBubble.innerHTML = `
                <div class="media-placeholder">
                    <i class="fas fa-video"></i> Video
                </div>
            `;
        } else if (subType === 'document') {
            messageBubble.innerHTML = `
                <div class="media-placeholder">
                    <i class="fas fa-file"></i> Document
                </div>
            `;
        } else {
            const messageText = document.createElement('p');
            messageText.textContent = content;
            
            // Convert URLs to clickable links
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            if (urlRegex.test(content)) {
                const linkedContent = content.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener" class="message-link">$1</a>');
                messageText.innerHTML = linkedContent;
                
                // Add click handlers for link confirmation
                messageText.querySelectorAll('.message-link').forEach(link => {
                    link.addEventListener('click', function(e) {
                        e.preventDefault();
                        const url = this.getAttribute('href');
                        showLinkConfirmation(url);
                    });
                });
            }
            messageBubble.appendChild(messageText);
        }

        // Add timestamp to all message types
        const timestampElement = document.createElement('div');
        timestampElement.classList.add('message-timestamp');
        timestampElement.textContent = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageBubble.appendChild(timestampElement);

        messageGroup.appendChild(messageBubble);
        messageArea.appendChild(messageGroup);
        messageArea.scrollTop = messageArea.scrollHeight;

        // Add long press for message deletion
        messageGroup.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(e, messageId, senderJid);
        });
        
        // Touch long press
        let longPressTimer;
        messageGroup.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                const touch = e.touches[0];
                showMessageContextMenu(touch, messageId, senderJid);
            }, 500);
        });
        messageGroup.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });
    }

    // --- Message Context Menu ---
    const messageContextMenu = document.getElementById('message-context-menu');
    let currentDeleteMessageId = null;
    let currentDeleteChatJid = null;

    function showMessageContextMenu(event, messageId, chatJid) {
        currentDeleteMessageId = messageId;
        currentDeleteChatJid = chatJid || activeChatJid;
        
        const x = event.clientX || event.pageX;
        const y = event.clientY || event.pageY;
        
        messageContextMenu.style.left = `${x}px`;
        messageContextMenu.style.top = `${y}px`;
        messageContextMenu.classList.remove('hidden');
        
        // Adjust if menu goes off screen
        const menuRect = messageContextMenu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            messageContextMenu.style.left = `${window.innerWidth - menuRect.width - 10}px`;
        }
        if (menuRect.bottom > window.innerHeight) {
            messageContextMenu.style.top = `${window.innerHeight - menuRect.height - 10}px`;
        }
    }

    function hideMessageContextMenu() {
        messageContextMenu.classList.add('hidden');
        currentDeleteMessageId = null;
        currentDeleteChatJid = null;
    }

    document.addEventListener('click', (e) => {
        if (!messageContextMenu.contains(e.target)) {
            hideMessageContextMenu();
        }
    });

    // Delete for me handler (local only)
    document.querySelector('.delete-message-me')?.addEventListener('click', async () => {
        if (!currentDeleteMessageId || !currentDeleteChatJid) return;
        
        try {
            const response = await fetch(`/api/delete-message/${currentDeleteChatJid}/${currentDeleteMessageId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                // Remove message from UI
                const messageElement = document.querySelector(`[data-message-id="${currentDeleteMessageId}"]`);
                if (messageElement) {
                    messageElement.remove();
                }
                // Remove from local data
                if (allChatsData[currentDeleteChatJid]) {
                    allChatsData[currentDeleteChatJid].messages = allChatsData[currentDeleteChatJid].messages.filter(
                        msg => msg.id !== currentDeleteMessageId
                    );
                }
            }
        } catch (error) {
            console.error('Error deleting message:', error);
        }
        
        hideMessageContextMenu();
    });

    // Delete for everyone handler (delete from WhatsApp)
    document.querySelector('.delete-message-everyone')?.addEventListener('click', async () => {
        if (!currentDeleteMessageId || !currentDeleteChatJid) return;
        
        try {
            const response = await fetch(`/api/delete-message/${currentDeleteChatJid}/${currentDeleteMessageId}?everyone=true`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                // Remove message from UI
                const messageElement = document.querySelector(`[data-message-id="${currentDeleteMessageId}"]`);
                if (messageElement) {
                    messageElement.remove();
                }
                // Remove from local data
                if (allChatsData[currentDeleteChatJid]) {
                    allChatsData[currentDeleteChatJid].messages = allChatsData[currentDeleteChatJid].messages.filter(
                        msg => msg.id !== currentDeleteMessageId
                    );
                }
            } else {
                const data = await response.json();
                alert(data.error || 'Failed to delete message for everyone');
            }
        } catch (error) {
            console.error('Error deleting message for everyone:', error);
        }
        
        hideMessageContextMenu();
    });

    // --- View & UI Logic ---
    function switchView(viewId) {
        if (viewId === 'chat-list-view') {
            chatListView.classList.remove('hidden');
            chatConversationView.classList.add('hidden');
        } else if (viewId === 'chat-conversation-view') {
            chatListView.classList.add('hidden');
            chatConversationView.classList.remove('hidden');
        }
    }

    // --- AI Mode Management ---
    async function setChatMode(jid, mode) {
        try {
            const backendModeMap = {
                'manual': 'A',
                'semiai': 'B',
                'aiauto': 'C'
            };
            
            const backendMode = backendModeMap[mode] || 'A';
            
            const response = await fetch(`/api/mode/${jid}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mode: backendMode })
            });

            if (response.ok) {
                showModeNotification(mode);
            }
        } catch (error) {
            console.error('Error setting chat mode:', error);
        }
    }

    function showModeNotification(mode) {
        const modeDescriptions = {
            'manual': 'Manual Mode - No AI assistance',
            'semiai': 'SemiAI Mode - Messages will be formalized',
            'aiauto': 'AiAuto Mode - AI will auto-respond'
        };
        
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--accent-color);
            color: white;
            padding: 12px 20px;
            border-radius: var(--border-radius-item);
            font-size: 0.9rem;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = modeDescriptions[mode] || 'Mode changed';
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => document.body.removeChild(notification), 300);
        }, 3000);
    }

    // --- Message Sending ---
    function sendMessage() {
        const messageText = messageInput.value.trim();
        if (!activeChatJid || !messageText) return;

        const messageId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString();

        // Add message to local data
        if (!allChatsData[activeChatJid]) {
            allChatsData[activeChatJid] = { 
                messages: [], 
                contact: allChatsData[activeChatJid]?.contact || { name: activeChatJid, profilePicUrl: getAvatarUrl(activeChatJid) }
            };
        }

        // Send to WhatsApp through server
        // Normalize JID to match the format in allChatsData (remove all suffixes)
        const normalizedTo = activeChatJid.replace(/@.*$/, '');
        console.log('Sending message to:', normalizedTo, 'from chat:', activeChatJid);
        socket.send(JSON.stringify({
            type: 'send',
            to: normalizedTo,
            message: messageText,
            id: messageId
        }));

        // Add to local data - use normalized JID
        const normalizedChatJid = activeChatJid.replace(/@.*$/, '');
        const currentMode = chatModeDropdown.value;
        const isSemiAIMode = currentMode === 'semiai';
        
        if (!allChatsData[normalizedChatJid]) {
            allChatsData[normalizedChatJid] = { messages: [], contact: { name: normalizedChatJid, profilePicUrl: getAvatarUrl(normalizedChatJid) } };
        }
        allChatsData[normalizedChatJid].messages.push({
            id: messageId,
            subType: 'chat',
            content: messageText,
            timestamp: timestamp,
            direction: 'sent',
            isOriginalInSemiAI: isSemiAIMode
        });

        // Display immediately
        appendMessage('chat', messageText, '', 'sent', timestamp, normalizedChatJid, messageId, isSemiAIMode);
        
        // Clear input and update UI
        messageInput.value = '';
        renderChatList();
    }

    // --- Event Listeners ---
    chatBackButton.addEventListener('click', () => {
        switchView('chat-list-view');
    });

    sendButton.addEventListener('click', sendMessage);

    attachButton.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,video/*,audio/*,.pdf,.doc,.doc,.txt';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && activeChatJid) {
                const reader = new FileReader();
                
                reader.onload = async (event) => {
                    const base64Data = event.target.result.split(',')[1];
                    
                    let subType = 'document';
                    if (file.type.startsWith('image/')) subType = 'image';
                    else if (file.type.startsWith('video/')) subType = 'video';
                    else if (file.type.startsWith('audio/')) subType = 'audio';
                    
                    const messageData = {
                        id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        subType: subType,
                        content: base64Data,
                        mimetype: file.type,
                        timestamp: new Date().toISOString(),
                        direction: 'sent'
                    };

                    allChatsData[activeChatJid].messages.push(messageData);

                    // Normalize JID
                    const normalizedChatJid = activeChatJid.replace(/@.*$/, '');
                    
                    socket.send(JSON.stringify({
                        type: 'send-file',
                        to: normalizedChatJid,
                        subType: subType,
                        content: base64Data,
                        mimetype: file.type,
                        filename: file.name,
                        caption: file.name
                    }));

                    // Display immediately in UI
                    appendMessage(subType, base64Data, file.type, 'sent', new Date().toISOString(), normalizedChatJid, messageData.id);
                };
                
                reader.readAsDataURL(file);
            }
        });
        
        fileInput.click();
    });

    // Search functionality
    searchInput.addEventListener('input', () => {
        renderChatList();
    });

    // Virtual scrolling functionality
    let scrollTimeout;
    chatItemsContainer.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            renderChatList();
            
            // Load more chats when scrolling near bottom
            const scrollPercentage = (chatItemsContainer.scrollTop + chatItemsContainer.clientHeight) / chatItemsContainer.scrollHeight;
            if (scrollPercentage > 0.8 && hasMoreChats && !isLoadingMore) {
                loadMoreChats();
            }
            }, 50); // Debounce scroll events
    });

    // Custom dropdown functionality
    const modeSelectorBtn = document.getElementById('mode-selector-btn');
    const modeDropdownMenu = document.getElementById('mode-dropdown-menu');
    const modeOptions = document.querySelectorAll('.mode-option');
    const modeIcon = document.getElementById('mode-icon');
    const modeLabel = document.getElementById('mode-label');

    const modeIcons = {
        'aiauto': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14"><path fill="currentColor" d="M352 64C352 46.3 337.7 32 320 32C302.3 32 288 46.3 288 64L288 128L192 128C139 128 96 171 96 224L96 448C96 501 139 544 192 544L448 544C501 544 544 501 544 448L544 224C544 171 501 128 448 128L352 128L352 64zM160 432C160 418.7 170.7 408 184 408L216 408C229.3 408 240 418.7 240 432C240 445.3 229.3 456 216 456L184 456C170.7 456 160 445.3 160 432zM280 432C280 418.7 290.7 408 304 408L336 408C349.3 408 360 418.7 360 432C360 445.3 349.3 456 336 456L304 456C290.7 456 280 445.3 280 432zM400 432C400 418.7 410.7 408 424 408L456 408C469.3 408 480 418.7 480 432C480 445.3 469.3 456 456 456L424 456C410.7 456 400 445.3 400 432zM224 240C250.5 240 272 261.5 272 288C272 314.5 250.5 336 224 336C197.5 336 176 314.5 176 288C176 261.5 197.5 240 224 240zM368 288C368 261.5 389.5 240 416 240C442.5 240 464 261.5 464 288C464 314.5 442.5 336 416 336C389.5 336 368 314.5 368 288zM64 288C64 270.3 49.7 256 32 256C14.3 256 0 270.3 0 288L0 384C0 401.7 14.3 416 32 416C49.7 416 64 401.7 64 384L64 288zM608 256C590.3 256 576 270.3 576 288L576 384C576 401.7 590.3 416 608 416C625.7 416 640 401.7 640 384L640 288C640 270.3 625.7 256 608 256z"/></svg>`,
        'semiai': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14"><path fill="currentColor" d="M184 120C184 89.1 209.1 64 240 64L264 64C281.7 64 296 78.3 296 96L296 544C296 561.7 281.7 576 264 576L232 576C202.2 576 177.1 555.6 170 528C169.3 528 168.7 528 168 528C123.8 528 88 492.2 88 448C88 430 94 413.4 104 400C84.6 385.4 72 362.2 72 336C72 305.1 89.6 278.2 115.2 264.9C108.1 252.9 104 238.9 104 224C104 179.8 139.8 144 184 144L184 120zM456 120L456 144C500.2 144 536 179.8 536 224C536 239 531.9 253 524.8 264.9C550.5 278.2 568 305 568 336C568 362.2 555.4 385.4 536 400C546 413.4 552 430 552 448C552 492.2 516.2 528 472 528C471.3 528 470.7 528 470 528C462.9 555.6 437.8 576 408 576L376 576C358.3 576 344 561.7 344 544L344 96C344 78.3 358.3 64 376 64L400 64C430.9 64 456 89.1 456 120z"/></svg>`,
        'manual': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14"><path fill="currentColor" d="M416 208C416 305.2 330 384 224 384C197.3 384 171.9 379 148.8 370L67.2 413.2C57.9 418.1 46.5 416.4 39 409C31.5 401.6 29.8 390.1 34.8 380.8L70.4 313.6C46.3 284.2 32 247.6 32 208C32 110.8 118 32 224 32C330 32 416 110.8 416 208zM416 576C321.9 576 243.6 513.9 227.2 432C347.2 430.5 451.5 345.1 463 229.3C546.3 248.5 608 317.6 608 400C608 439.6 593.7 476.2 569.6 505.6L605.2 572.8C610.1 582.1 608.4 593.5 601 601C593.6 608.5 582.1 610.2 572.8 605.2L491.2 562C468.1 571 442.7 576 416 576z"/></svg>`
    };

    const modeLabels = {
        'aiauto': 'AutoAI',
        'semiai': 'SemiAI',
        'manual': 'Manual'
    };

    function updateCustomDropdown(mode) {
        modeIcon.innerHTML = modeIcons[mode];
        modeLabel.textContent = modeLabels[mode];
        modeSelectorBtn.setAttribute('data-mode', mode);
        
        modeOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.value === mode);
        });
    }

    if (modeSelectorBtn) {
        modeSelectorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modeDropdownMenu.classList.toggle('show');
        });

        modeOptions.forEach(opt => {
            opt.addEventListener('click', async () => {
                const selectedMode = opt.dataset.value;
                chatModeDropdown.value = selectedMode;
                updateCustomDropdown(selectedMode);
                modeDropdownMenu.classList.remove('show');
                
                if (activeChatJid) {
                    updateModeIndicator(selectedMode);
                    await setChatMode(activeChatJid, selectedMode);
                }
            });
        });

        document.addEventListener('click', () => {
            modeDropdownMenu.classList.remove('show');
        });
    }

    // Theme dropdown functionality
    const themeSelectorBtn = document.getElementById('theme-selector-btn');
    const themeDropdownMenu = document.getElementById('theme-dropdown-menu');
    const themeOptions = document.querySelectorAll('.theme-option');
    const themeIcon = document.getElementById('theme-icon');
    const themeLabel = document.getElementById('theme-label');

    const themeIcons = {
        'kawaii': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14"><path fill="currentColor" d="M320 96C241.5 96 176 146.5 144 216C184.4 216 220.7 233.3 248.8 261.2C267.3 279.7 293.3 279.7 311.8 261.2C330.3 242.7 356.3 242.7 374.8 261.2C402.9 289.3 439.2 306.6 479.6 306.6C497.1 306.6 511.2 294.5 520.4 279.3C522.9 275.3 527.3 273 532 273C537.3 273 542.2 276 544 280.5C560.4 307.5 570.7 340.7 570.7 376C570.7 444.5 514.2 501 445.7 501C381.8 501 328.9 449.9 326.2 386.3C325.8 376.8 317.4 369.4 307.9 369.4C298.3 369.4 289.9 376.8 289.6 386.4C286.7 436.7 243.9 477.2 193.4 477.2C125.7 477.2 70.4 421.9 70.4 354.2C70.4 296.3 111.5 246.4 163.7 232.4C148.8 168.4 196.3 114.9 261.4 106.7C278.1 105.1 292.3 93.5 296.2 77.3C296.8 75.5 298.4 74 300.3 74C302.5 74 304.6 75.3 305.7 77.3C312.5 90.6 329.2 98.5 346.4 98.5C382.5 98.5 412.1 86.3 432.9 66.2C443.8 55.4 458.5 50.3 474.1 50.3C493.4 50.3 511 59 522.9 73.2C545.1 100.2 555.3 134.5 555.3 170.8C555.3 240.2 498 297.5 428.6 297.5C406.5 297.5 385.4 291.5 366.3 280.8C353.4 273.3 337.4 273.3 324.5 280.8C311.6 288.3 302.9 302.3 302.9 317.2C302.9 332.1 311.6 346.1 324.5 353.6C343.6 364.3 364.7 370.3 386.8 370.3C446 370.3 494.2 322.1 494.2 262.9C494.2 239.5 487.2 217.2 475.1 198.3C463 179.4 445.8 165.1 424.7 156.9C411.6 151.8 400.6 143.2 392.6 131.7C380.9 114.9 376.6 94.1 380.8 73.8C381.5 69.9 385.1 67 389 67C393.4 67 397.4 70.1 397.8 74.5C400.5 91.7 409.1 107.5 422.5 119.1C441.1 135.2 464.6 144.2 489.2 144.2C525.3 144.2 556.4 127.5 577.2 102.1C582.8 95.2 590.6 91.2 599 91.2C608.4 91.2 617 96.3 620.9 104.7C630.5 125.1 635.7 148.4 635.7 173.3C635.7 243.6 578.3 301 508 301C469.5 301 435.1 285.5 410.2 259.8C394.3 243.2 368.3 243.2 352.4 259.8C336.5 276.4 336.5 302.4 352.4 318.9C360.7 327.2 371.3 331.7 382.4 331.7C393.5 331.7 404.1 327.2 412.4 318.9C428.3 303.2 452.2 303.2 468.1 318.9C491.1 341.9 491.1 379.4 468.1 402.4C437.1 433.4 393.1 451.7 346.4 451.7C271.8 451.7 210.4 390.3 210.4 315.7C210.4 302.1 211.8 288.7 214.5 275.7C215.5 270.6 219.7 267 225 267H262.5C268 267 272.5 270.5 273 276C275.2 291.5 283.6 305.7 296.3 316.1C313.5 330.5 335.8 338.7 359.3 338.7C411.5 338.7 455.1 299.9 462.6 249.3C463.1 245.5 466.7 242.7 470.6 242.7C474.9 242.7 478.6 245.8 479.2 250C481.8 264.5 483.5 279.4 483.5 294.5C483.5 355.6 434.4 404.7 373.3 404.7C334.9 404.7 300.5 388.8 275.9 362.8C260 346.9 234 346.9 218.1 362.8C202.2 378.7 202.2 404.7 218.1 420.6C226.4 428.9 237 433.4 248.1 433.4C259.2 433.4 269.8 428.9 278.1 420.6C294 404.7 318 404.7 333.9 420.6C356.9 443.6 356.9 481.1 333.9 504.1C319.5 518.5 300.4 526.7 280.4 526.7C260.4 526.7 240.3 518.5 225.9 504.1C199.3 477.5 199.3 435.1 225.9 408.5C241.8 392.6 241.8 366.6 225.9 350.7C217.6 342.4 207 337.9 195.9 337.9C184.8 337.9 174.2 342.4 165.9 350.7C150 366.6 150 392.6 165.9 408.5C173.6 416.2 183.7 419.9 194.2 419.9C204.7 419.9 214.8 416.2 222.5 408.5C239.7 391.3 264.7 391.3 281.9 408.5C307.1 433.7 307.1 477.5 281.9 502.7C267.9 516.7 249.4 524.1 229.8 524.1C210.2 524.1 190.7 516.7 176.7 502.7C150.1 476.1 150.1 433.7 176.7 407.1C193.9 389.9 218.9 389.9 236.1 407.1C260.5 431.5 260.5 474.5 236.1 498.9C222.1 512.9 203.6 520.3 184 520.3C164.4 520.3 145.9 512.9 131.9 498.9C105.3 472.3 105.3 429.9 131.9 403.3C149.1 386.1 174.1 386.1 191.3 403.3C215.7 427.7 215.7 470.7 191.3 495.1C177.3 509.1 158.8 516.5 139.2 516.5C119.6 516.5 101.1 509.1 87.1 495.1C60.5 468.5 60.5 426.1 87.1 399.5C104.3 382.3 129.3 382.3 146.5 399.5C170.9 423.9 170.9 466.9 146.5 491.3C132.5 505.3 114 512.7 94.4 512.7C74.8 512.7 56.3 505.3 42.3 491.3C15.7 464.7 15.7 422.3 42.3 395.7C59.5 378.5 84.5 378.5 101.7 395.7C126.1 420.1 126.1 463.1 101.7 487.5C87.7 501.5 69.2 508.9 49.6 508.9C30 508.9 11.5 501.5 -2.5 487.5C-29.1 460.9 -29.1 418.5 -2.5 391.9C14.7 374.7 39.7 374.7 56.9 391.9C81.3 416.3 81.3 459.3 56.9 483.7C42.9 497.7 24.4 505.1 4.8 505.1C-14.8 505.1 -33.3 497.7 -47.3 483.7C-73.9 457.1 -73.9 414.7 -47.3 388.1C-30.1 370.9 -5.1 370.9 12.1 388.1C36.5 412.5 36.5 455.5 12.1 479.9C-1.9 493.9 -20.4 501.3 -40 501.3C-59.6 501.3 -78.1 493.9 -92.1 479.9C-118.7 453.3 -118.7 410.9 -92.1 384.3C-74.9 367.1 -49.9 367.1 -32.7 384.3C-8.3 408.7 -8.3 451.7 -32.7 476.1C-46.7 490.1 -65.2 497.5 -84.8 497.5C-104.4 497.5 -122.9 490.1 -136.9 476.1C-163.5 449.5 -163.5 407.1 -136.9 380.5C-119.7 363.3 -94.7 363.3 -77.5 380.5C-53.1 404.9 -53.1 447.9 -77.5 472.3C-91.5 486.3 -110 493.7 -129.6 493.7C-149.2 493.7 -167.7 486.3 -181.7 472.3C-208.3 445.7 -208.3 403.3 -181.7 376.7C-164.5 359.5 -139.5 359.5 -122.3 376.7C-97.9 401.1 -97.9 444.1 -122.3 468.5C-136.3 482.5 -154.8 489.9 -174.4 489.9C-194 489.9 -212.5 482.3 -226.5 468.5C-253.1 441.9 -253.1 399.5 -226.5 372.9C-209.3 355.7 -184.3 355.7 -167.1 372.9C-142.7 397.3 -142.7 440.3 -167.1 464.7C-181.1 478.7 -199.6 486.1 -219.2 486.1C-238.8 486.1 -257.3 478.7 -271.3 464.7C-297.9 438.1 -297.9 395.7 -271.3 369.1C-254.1 351.9 -229.1 351.9 -211.9 369.1C-187.5 393.5 -187.5 436.5 -211.9 460.9C-225.9 474.9 -244.4 482.3 -264 482.3C-283.6 482.3 -302.1 474.9 -316.1 460.9C-342.7 434.3 -342.7 391.9 -316.1 365.3C-298.9 348.1 -273.9 348.1 -256.7 365.3C-232.3 389.7 -232.3 432.7 -256.7 457.1C-270.7 471.1 -289.2 478.5 -308.8 478.5C-328.4 478.5 -346.9 471.1 -360.9 457.1C-387.5 430.5 -387.5 388.1 -360.9 361.5C-343.7 344.3 -318.7 344.3 -301.5 361.5C-277.1 385.9 -277.1 428.9 -301.5 453.3C-315.5 467.3 -334 474.7 -353.6 474.7C-373.2 474.7 -391.7 467.3 -405.7 453.3C-432.3 426.7 -432.3 384.3 -405.7 357.7C-388.5 340.5 -363.5 340.5 -346.3 357.7C-321.9 382.1 -321.9 425.1 -346.3 449.5C-360.3 463.5 -378.8 470.9 -398.4 470.9C-418 470.9 -436.5 463.3 -450.5 449.5C-477.1 422.9 -477.1 380.5 -450.5 353.9C-433.3 336.7 -408.3 336.7 -391.1 353.9C-366.7 378.3 -366.7 421.3 -391.1 445.7C-405.1 459.7 -423.6 467.1 -443.2 467.1C-462.8 467.1 -481.3 459.7 -495.3 445.7C-521.9 419.1 -521.9 376.7 -495.3 350.1C-478.1 332.9 -453.1 332.9 -435.9 350.1C-411.5 374.5 -411.5 417.5 -435.9 441.9C-449.9 455.9 -468.4 463.3 -488 463.3C-507.6 463.3 -526.1 455.9 -540.1 441.9C-566.7 415.3 -566.7 372.9 -540.1 346.3C-522.9 329.1 -497.9 329.1 -480.7 346.3C-456.3 370.7 -456.3 413.7 -480.7 438.1C-494.7 452.1 -513.2 459.5 -532.8 459.5C-552.4 459.5 -570.9 452.1 -584.9 438.1C-611.5 411.5 -611.5 369.1 -584.9 342.5C-567.7 325.3 -542.7 325.3 -525.5 342.5C-501.1 366.9 -501.1 409.9 -525.5 434.3C-539.5 448.3 -558 455.7 -577.6 455.7C-597.2 455.7 -615.7 448.3 -629.7 434.3C-656.3 407.7 -656.3 365.3 -629.7 338.7C-612.5 321.5 -587.5 321.5 -570.3 338.7C-545.9 363.1 -545.9 406.1 -570.3 430.5C-584.3 444.5 -602.8 451.9 -622.4 451.9C-642 451.9 -660.5 444.3 -674.5 430.5"/></svg>`,
        'royal': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14"><path fill="currentColor" d="M352 64C352 46.3 337.7 32 320 32C302.3 32 288 46.3 288 64L288 128L192 128C139 128 96 171 96 224L96 448C96 501 139 544 192 544L448 544C501 544 544 501 544 448L544 224C544 171 501 128 448 128L352 128L352 64zM160 432C160 418.7 170.7 408 184 408L216 408C229.3 408 240 418.7 240 432C240 445.3 229.3 456 216 456L184 456C170.7 456 160 445.3 160 432zM280 432C280 418.7 290.7 408 304 408L336 408C349.3 408 360 418.7 360 432C360 445.3 349.3 456 336 456L304 456C290.7 456 280 445.3 280 432zM400 432C400 418.7 410.7 408 424 408L456 408C469.3 408 480 418.7 480 432C480 445.3 469.3 456 456 456L424 456C410.7 456 400 445.3 400 432zM224 240C250.5 240 272 261.5 272 288C272 314.5 250.5 336 224 336C197.5 336 176 314.5 176 288C176 261.5 197.5 240 224 240zM368 288C368 261.5 389.5 240 416 240C442.5 240 464 261.5 464 288C464 314.5 442.5 336 416 336C389.5 336 368 314.5 368 288zM64 288C64 270.3 49.7 256 32 256C14.3 256 0 270.3 0 288L0 384C0 401.7 14.3 416 32 416C49.7 416 64 401.7 64 384L64 288zM608 256C590.3 256 576 270.3 576 288L576 384C576 401.7 590.3 416 608 416C625.7 416 640 401.7 640 384L640 288C640 270.3 625.7 256 608 256z"/></svg>`,
        'catpuccin': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14"><path fill="currentColor" d="M320 128C194.7 128 96 176.4 96 256v128c0 79.6 98.7 128 224 128s224-48.4 224-128V256c0-79.6-98.7-128-224-128zM176 280c0-57.9 69.4-88 144-88s144 30.1 144 88v32c0 57.9-69.4 88-144 88s-144-30.1-144-88v-32zm288 0c0-57.9 69.4-88 144-88s144 30.1 144 88v32c0 57.9-69.4 88-144 88s-144-30.1-144-88v-32z"/></svg>`,
        'frappe': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="14" height="14"><path fill="currentColor" d="M320 128C194.7 128 96 176.4 96 256v128c0 79.6 98.7 128 224 128s224-48.4 224-128V256c0-79.6-98.7-128-224-128zM176 280c0-57.9 69.4-88 144-88s144 30.1 144 88v32c0 57.9-69.4 88-144 88s-144-30.1-144-88v-32zm288 0c0-57.9 69.4-88 144-88s144 30.1 144 88v32c0 57.9-69.4 88-144 88s-144-30.1-144-88v-32z"/></svg>`
    };

    const themeLabelsMap = {
        'kawaii': 'Kawaii',
        'royal': 'Royal Dark',
        'catpuccin': 'Catppuccin Mocha',
        'frappe': 'Catppuccin Frappe'
    };

    function updateThemeSelector(theme) {
        themeIcon.innerHTML = themeIcons[theme];
        themeLabel.textContent = themeLabelsMap[theme];
        
        themeOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.value === theme);
        });
    }

    if (themeSelectorBtn) {
        themeSelectorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            themeDropdownMenu.classList.toggle('show');
        });

        themeOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                const selectedTheme = opt.dataset.value;
                themeSelect.value = selectedTheme;
                updateThemeSelector(selectedTheme);
                themeDropdownMenu.classList.remove('show');
            });
        });

        document.addEventListener('click', () => {
            themeDropdownMenu.classList.remove('show');
        });
    }

    // Chat mode change listener
    chatModeDropdown.addEventListener('change', async (e) => {
        if (activeChatJid) {
            const newMode = e.target.value;
            updateModeIndicator(newMode); // Update immediately
            await setChatMode(activeChatJid, newMode);
        }
    });

    // --- Settings Functions ---
    function loadSettings() {
        const savedSettings = localStorage.getItem('whatsAppAssistantSettings');
        if (savedSettings) {
            appSettings = JSON.parse(savedSettings);
            groqApiKeyInput.value = appSettings.groqApiKey;
            aiTrainingTextarea.value = appSettings.aiTraining;
            aiScheduleTextarea.value = appSettings.aiSchedule;
            if (appSettings.theme) {
                themeSelect.value = appSettings.theme;
                applyTheme(appSettings.theme);
                updateThemeSelector(appSettings.theme);
            }
        }
    }

    function applyTheme(theme) {
        if (theme === 'royal') {
            document.body.setAttribute('data-theme', 'royal');
        } else if (theme === 'catpuccin') {
            document.body.setAttribute('data-theme', 'catpuccin');
        } else if (theme === 'frappe') {
            document.body.setAttribute('data-theme', 'frappe');
        } else {
            document.body.removeAttribute('data-theme');
        }
        updateScrollButtonIcon(theme);
    }

    function updateScrollButtonIcon(theme) {
        const scrollBtn = document.getElementById('scroll-to-bottom-btn');
        if (!scrollBtn) return;
        
        const icons = {
            kawaii: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M480-600q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm-70.5 218.5Q378-403 364-438q-5 0-9 .5t-9 .5q-52 0-89-37t-37-89q0-21 7-40.5t21-36.5q-13-17-20-36.5t-7-40.5q0-52 36.5-89t88.5-37q5 0 9 .5t9 .5q14-35 45.5-56.5T480-920q39 0 70.5 21.5T596-842q5 0 9-.5t9-.5q52 0 88.5 37t36.5 89q0 21-6.5 40.5T712-640q13 17 20 36.5t7 40.5q0 52-36.5 89T614-437q-5 0-9-.5t-9-.5q-14 35-45.5 56.5T480-360q-39 0-70.5-21.5ZM480-80q0-74 28.5-139.5T586-334q49-49 114.5-77.5T840-440q0 74-28.5 139.5T734-186q-49 49-114.5 77.5T480-80Zm98-98q57-21 100-64t64-100q-57 21-100 64t-64 100Zm-98 98q0-74-28.5-139.5T374-334q-49-49-114.5-77.5T120-440q0 74 28.5 139.5T226-186q49 49 114.5 77.5T480-80Zm-98-98q-57-21-100-64t-64-100q57 21 100 64t64 100Zm196 0Zm-196 0Zm232-339q19 0 32.5-13.5T660-563q0-14-7.5-24.5T633-604l-35-17q-2 11-6 21.5t-9 19.5q-5 9-12 17t-15 15l32 23q5 4 11.5 6t14.5 2Zm-16-142 35-17q12-6 19-17t7-24q0-19-13-32.5T614-763q-8 0-14 2t-12 6l-33 23q8 7 15.5 15t12.5 17q5 9 9 19.5t6 21.5Zm-159-93q10-4 20-6t21-2q11 0 21 2t20 6l5-44q2-18-12.5-31T480-840q-19 0-33.5 13T434-796l5 44Zm41 312q19 0 33.5-13t12.5-31l-5-44q-10 4-20 6t-21 2q-11 0-21-2t-20-6l-5 44q-2 18 12.5 31t33.5 13ZM362-659q2-11 6-21.5t9-19.5q5-9 12-17t15-15l-32-23q-5-4-11.5-6t-14.5-2q-19 0-32.5 13.5T300-717q0 13 7.5 24t19.5 17l35 17Zm-16 141q8 0 14-1.5t12-6.5l33-22q-8-7-15.5-15T377-580q-5-9-9-19.5t-6-21.5l-35 17q-12 6-19 17t-7 24q1 19 13.5 32t31.5 13Zm237-62Zm0-120Zm-103-60Zm0 240ZM377-700Zm0 120Z"/></svg>`,
            royal: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="24" height="24"><path fill="#e3e3e3" d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z"/></svg>`,
            catpuccin: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M180-475q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29Zm109-189q-29-29-29-71t29-71q29-29 71-29t71 29q29 29 29 71t-29 71q-29 29-71 29t-71-29Zm240 0q-29-29-29-71t29-71q29-29 71-29t71 29q29 29 29 71t-29 71q-29 29-71 29t-71-29Zm251 189q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29ZM266-75q-45 0-75.5-34.5T160-191q0-52 35.5-91t70.5-77q29-31 50-67.5t50-68.5q22-26 51-43t63-17q34 0 63 16t51 42q28 32 49.5 69t50.5 69q35 38 70.5 77t35.5 91q0 47-30.5 81.5T694-75q-54 0-107-9t-107-9q-54 0-107 9t-107 9Z"/></svg>`,
            frappe: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M440-240q-117 0-198.5-81.5T160-520v-240q0-33 23.5-56.5T240-840h500q58 0 99 41t41 99q0 58-41 99t-99 41h-20v40q0 117-81.5 198.5T440-240ZM240-640h400v-120H240v120Zm200 320q83 0 141.5-58.5T640-520v-40H240v40q0 83 58.5 141.5T440-320Zm280-320h20q25 0 42.5-17.5T800-700q0-25-17.5-42.5T740-760h-20v120ZM160-120v-80h640v80H160Zm280-440Z"/></svg>`
        };
        
        scrollBtn.innerHTML = icons[theme] || icons.kawaii;
    }
    
    function saveSettings() {
        appSettings.groqApiKey = groqApiKeyInput.value;
        appSettings.aiTraining = aiTrainingTextarea.value;
        appSettings.aiSchedule = aiScheduleTextarea.value;
        appSettings.theme = themeSelect.value;
        applyTheme(themeSelect.value);
        updateThemeSelector(themeSelect.value);
        localStorage.setItem('whatsAppAssistantSettings', JSON.stringify(appSettings));
        
        // Save to server
        fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(appSettings)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('Settings saved!');
                settingsModal.classList.add('hidden');
            } else {
                showToast('Failed to save settings');
            }
        })
        .catch(error => {
            console.error('Error saving settings:', error);
            showToast('Error saving settings');
        });
    }

    // Toast notification function
    const toast = document.getElementById('settings-toast');
    const toastMessage = document.getElementById('toast-message');
    let toastTimeout;

    function showToast(message) {
        toastMessage.textContent = message;
        toast.classList.remove('hidden');
        
        // Small delay to allow CSS transition to work
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.classList.add('hidden');
            }, 300);
        }, 3000);
    }

    // --- Contacts Sync ---
    const syncModal = document.getElementById('sync-modal');
    const syncContactCount = document.getElementById('sync-contact-count');
    const syncEstTime = document.getElementById('sync-est-time');
    const confirmSyncBtn = document.getElementById('confirm-sync');
    const cancelSyncBtn = document.getElementById('cancel-sync');
    const closeSyncModal = document.getElementById('close-sync-modal');
    const syncProgressBar = document.getElementById('sync-progress-bar');
    const syncProgressText = document.getElementById('sync-progress-text');
    const syncErrorModal = document.getElementById('sync-error-modal');
    const syncErrorMessage = document.getElementById('sync-error-message');
    const syncSuccessModal = document.getElementById('sync-success-modal');
    const syncSuccessMessage = document.getElementById('sync-success-message');
    let syncConfirmed = false;
    let syncProgressPoller = null;

    function showSyncError(message) {
        syncErrorMessage.textContent = message || 'Something went wrong. Please try again.';
        syncErrorModal.classList.remove('hidden');
    }

    function showSyncSuccess(message) {
        syncSuccessMessage.textContent = message || 'Successfully synced contacts.';
        syncSuccessModal.classList.remove('hidden');
    }

    document.getElementById('close-error-sync')?.addEventListener('click', () => {
        syncErrorModal.classList.add('hidden');
    });
    document.getElementById('close-success-sync')?.addEventListener('click', () => {
        syncSuccessModal.classList.add('hidden');
    });
    syncErrorModal?.addEventListener('click', (e) => {
        if (e.target === syncErrorModal) syncErrorModal.classList.add('hidden');
    });
    syncSuccessModal?.addEventListener('click', (e) => {
        if (e.target === syncSuccessModal) syncSuccessModal.classList.add('hidden');
    });
    
    async function showSyncPreview() {
        syncContactsButton.style.opacity = '0.5';
        try {
            const previewRes = await fetch('/api/sync-contacts-preview');
            const previewData = await previewRes.json();
            
            if (!previewData.success) {
                showSyncError(previewData.error || 'Could not get contact info. Make sure WhatsApp is connected.');
                syncContactsButton.style.opacity = '1';
                return;
            }
            
            const count = previewData.count;
            
            syncContactCount.innerHTML = `Found <strong>${count}</strong> contacts to sync.`;
            syncModal.classList.remove('hidden');
            
        } catch (error) {
            console.error('Error getting preview:', error);
            showSyncError('Error getting contact info');
        } finally {
            syncContactsButton.style.opacity = '1';
        }
    }
    
    async function syncContacts() {
        if (!syncConfirmed) return;
        syncConfirmed = false;
        syncModal.classList.add('hidden');
        
        // Show progress bar
        syncProgressBar.classList.add('visible');
        syncProgressText.textContent = 'Starting sync...';
        
        // Start polling for progress
        syncProgressPoller = setInterval(async () => {
            try {
                const res = await fetch('/api/sync-progress');
                const data = await res.json();
                if (data.isRunning && data.total > 0) {
                    syncProgressText.textContent = `Syncd ${data.processed}/${data.total} contacts...`;
                }
            } catch (e) {}
        }, 1500);
        
        try {
            syncContactsButton.style.opacity = '0.5';
            syncContactsButton.style.pointerEvents = 'none';
            syncContactsButton.classList.add('fa-spin');
            
            const response = await fetch('/api/sync-contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success && data.updatedChats) {
                allChatsData = data.updatedChats; // Directly update allChatsData with the comprehensive data from the server
                
                // Ensure each chat has a messages array (though it should already be handled by backend)
                for (const jid in allChatsData) {
                    if (!allChatsData[jid].messages) {
                        allChatsData[jid].messages = [];
                    }
                }
                
                renderChatList();
                showSyncSuccess(`Successfully synced ${data.totalProcessed || 'all'} contacts! Displaying ${Object.keys(allChatsData).length} chats!`);
            } else {
                showSyncError(data.error || 'Unknown error');
            }
        } catch (error) {
            console.error('Error syncing contacts:', error);
            showSyncError('Error syncing contacts. Please check your connection.');
        } finally {
            // Stop polling and hide progress bar
            if (syncProgressPoller) {
                clearInterval(syncProgressPoller);
                syncProgressPoller = null;
            }
            syncProgressBar.classList.remove('visible');
            syncContactsButton.style.opacity = '1';
            syncContactsButton.style.pointerEvents = 'auto';
            syncContactsButton.classList.remove('fa-spin');
        }
    }

    // Sync modal event listeners
    syncContactsButton.addEventListener('click', () => {
        syncConfirmed = false;
        showSyncPreview();
    });
    
    confirmSyncBtn.addEventListener('click', () => {
        syncConfirmed = true;
        syncContacts();
    });
    
    cancelSyncBtn.addEventListener('click', () => {
        syncModal.classList.add('hidden');
    });
    
    closeSyncModal.addEventListener('click', () => {
        syncModal.classList.add('hidden');
    });
    
    syncModal.addEventListener('click', (e) => {
        if (e.target === syncModal) {
            syncModal.classList.add('hidden');
        }
    });
    
    // Link Confirmation Modal
    const linkModal = document.getElementById('link-modal');
    const linkUrlDisplay = document.getElementById('link-url-display');
    const cancelLinkBtn = document.getElementById('cancel-link');
    const confirmLinkBtn = document.getElementById('confirm-link');
    let pendingLinkUrl = null;
    
    function showLinkConfirmation(url) {
        pendingLinkUrl = url;
        linkUrlDisplay.textContent = url;
        linkModal.classList.add('show');
    }
    
    cancelLinkBtn.addEventListener('click', () => {
        linkModal.classList.remove('show');
        pendingLinkUrl = null;
    });
    
    confirmLinkBtn.addEventListener('click', () => {
        if (pendingLinkUrl) {
            window.open(pendingLinkUrl, '_blank', 'noopener,noreferrer');
        }
        linkModal.classList.remove('show');
        pendingLinkUrl = null;
    });
    
    linkModal.addEventListener('click', (e) => {
        if (e.target === linkModal) {
            linkModal.classList.remove('show');
            pendingLinkUrl = null;
        }
    });
    
    function closeSettings() {
        settingsModal.classList.add('hidden');
    }
    
    function openSettings() {
        settingsModal.classList.remove('hidden');
    }

    // --- Settings Event Listeners ---
    settingsButton.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', closeSettings);
    saveSettingsBtn.addEventListener('click', saveSettings);
    
    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettings();
        }
    });

    // --- Event Listeners ---
    settingsButton.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    // --- Initialize ---
    loadSettings();
    updateScrollButtonIcon(appSettings.theme || 'kawaii');
    connectWebSocket();
});