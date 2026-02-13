const axios = require('axios');

const AI_MODEL = "llama-3.1-8b-instant";
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Generates an AI reply using the Groq API.
 * @param {string} userMessage The message from the user.
 * @param {string} systemInstruction The system-level instruction for the AI (e.g., persona).
 * @param {string} apiKey Optional API key to use (will fall back to env var if not provided).
 * @returns {Promise<string>} The AI-generated reply.
 */
async function getAIReply(userMessage, systemInstruction = "", apiKey = null) {
    const groqApiKey = apiKey || process.env.GROQ_API_KEY;
    
    if (!groqApiKey) {
        throw new Error('GROQ_API_KEY is not set. Please add your API key in Settings.');
    }

    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userMessage }
        ],
        max_tokens: 150,
        temperature: 0.7
    };

    try {
        const response = await axios.post(GROQ_API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 seconds timeout
        });

        if (response.data.choices && response.data.choices.length > 0) {
            let reply = response.data.choices[0].message.content.trim();
            // Soft limit around 15 words for brevity, but allow longer natural responses when needed
            let words = reply.split(/\s+/);
            if (words.length > 25) {
                // Only truncate if extremely long, keeping it natural
                reply = words.slice(0, 25).join(' ') + '...';
            }
            return reply;
        } else {
            throw new Error('Invalid response structure from Groq API.');
        }

    } catch (error) {
        console.error('Error calling Groq API:', error.response ? error.response.data : error.message);
        console.error('API Key exists:', !!groqApiKey);
        console.error('API URL:', GROQ_API_URL);
        console.error('Model:', AI_MODEL);
        throw new Error('Failed to get AI reply from Groq.');
    }
}

module.exports = { getAIReply };
