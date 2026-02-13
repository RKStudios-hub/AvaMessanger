// --- Event Listeners ---
chatBackButton.addEventListener('click', showChatList);
sendButton.addEventListener('click', sendMessage);
attachButton.addEventListener('click', handleAttachment);

// Chat mode change listener
chatModeDropdown.addEventListener('change', async (e) => {
    if (activeChatJid) {
        const newMode = e.target.value;
        await setChatMode(activeChatJid, newMode);
    }
});

// WebSocket message handling
socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.type === 'message') {
        handleIncomingMessage(data);
    }
};

function handleIncomingMessage(data) {
    const { from, subType, content, mimetype, timestamp, direction, contactName, contactProfilePicUrl, id } = data;
    const remoteJid = from;

    // Skip if this is a message we sent locally (echo from server)
    if (id && id.startsWith('client_') && locallySentMessages.has(id)) {
        console.log('Skipping echo of our own message:', id);
        return;
    }

    const fallbackDp = getAvatarUrl(remoteJid);
    const dpUrl = contactProfilePicUrl || fallbackDp;
    if (!allChatsData[remoteJid]) {
        allChatsData[remoteJid] = { messages: [], contact: { name: contactName || remoteJid, profilePicUrl: dpUrl } };
    } else {
        allChatsData[remoteJid].contact = { name: contactName || remoteJid, profilePicUrl: dpUrl };
    }

    const messageData = {
        id: id || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        subType: subType,
        content: content,
        mimetype: mimetype,
        timestamp: timestamp,
        direction: direction || 'received'
    };

    // Add message to data
    allChatsData[remoteJid].messages.push(messageData);
    renderChatList();

    // Show in UI if it's the active chat
    if (remoteJid === activeChatJid) {
        appendMessage(subType, content, mimetype, direction || 'received', timestamp, remoteJid, id);
    }
}