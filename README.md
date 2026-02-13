# AvaMessaging 🤖💬

A beautiful WhatsApp web client with built-in AI assistant features. Send messages, images, and more with a modern glassmorphism UI that feels just like the official WhatsApp Web — but smarter.

## Features

### Multi-Chat Support
Handle all your WhatsApp conversations in one convenient place. View and manage all your chats with a beautiful, intuitive interface that makes switching between conversations seamless and easy.

### AI-Powered Modes
Choose between three different AI modes to enhance your messaging experience:

- **AutoAI Mode**: The AI automatically generates intelligent replies based on your conversation context and personal chat style. Perfect for quick, smart responses.
- **Semi-AI Mode**: Automatically corrects your grammar and converts Hinglish (Hindi-English mix) to proper English before sending. Your messages are polished while maintaining your original meaning.
- **Manual Mode**: You have full control. Send messages as you type them without any AI modifications.

### Beautiful Themes
AvaMessaging comes with 4 stunning themes to match your mood and style:

- **Kawaii**: Soft pink and purple gradients with a cute, playful aesthetic
- **Royal Dark**: Deep purple elegance with a sophisticated dark mode interface
- **Catppuccin Mocha**: Calm coffee tones for a relaxing visual experience
- **Frappe**: Pastel vibes with soft, soothing colors

### Smart Message Sync
Automatically synchronizes all your WhatsApp messages from your phone. The sync feature intelligently fetches your contacts and chat history, making sure you never miss a conversation.

### Media Sharing
Share images, videos, audio messages, and documents directly through the web interface. Support for various media types makes communication richer and more expressive.

### Message Deletion
Delete messages for yourself or everyone in the chat (subject to WhatsApp's time limitations). Manage your conversation history with ease.

### Real-time Updates
Experience instant message delivery and receiving via WebSocket technology. Messages appear in real-time without needing to refresh the page.

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- A WhatsApp account
- A Groq API key (free from [groq.com](https://groq.com))

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/RKStudios-hub/AvaMessanger.git
   cd AvaMessanger
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your environment:
   - Open the `.env` file
   - Add your Groq API key:
     ```
     GROQ_API_KEY=your_groq_api_key_here
     ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open your browser and navigate to:
   ```
   http://localhost:3001
   ```

6. Scan the QR code with your WhatsApp mobile app to connect.

## Configuration

Customize your experience in the Settings menu:

### Groq API Settings
Enter your Groq API key to enable AI features. Get a free API key from [groq.com](https://groq.com).

### AI Training
Train the AI about yourself by entering information such as:
- Your name and basic details
- Your communication style preferences
- Any specific terminology or phrases you commonly use
- Your schedule and availability

### AI Schedule
Set your daily schedule to help the AI provide more contextually appropriate responses. For example:
- 9AM-12PM: Work meetings
- 1PM-5PM: Available for chat
- 6PM-10PM: Family time

### Theme Selection
Choose from 4 beautiful themes to personalize your interface.

## AI Modes Explained

### AutoAI Mode
When enabled, the AI analyzes the conversation context and generates suggested replies that match your communication style. Simply tap on the suggestion to send it, or type your own message.

### Semi-AI Mode
This mode acts as your personal grammar assistant:
- Automatically fixes grammar and punctuation errors
- Converts Hinglish (like "mai theek hu" or "tum kya kar rahe ho") to proper English ("I am fine" / "What are you doing")
- Shows you both the original and corrected version before sending

### Manual Mode
Full manual control with no AI intervention. Type and send messages exactly as you write them.

## Tech Stack

- **Backend**: Node.js, Express
- **WhatsApp Integration**: WPPConnect
- **Frontend**: Vanilla JavaScript, CSS3 with glassmorphism effects
- **Real-time Communication**: WebSocket for instant messaging
- **AI**: Groq API with LLaMA 3.1 model for intelligent responses
- **UI Icons**: Font Awesome

## Project Structure

```
AvaMessanger/
├── server.js          # Main server file with API endpoints
├── ai.js             # AI integration with Groq API
├── data-storage.js   # Local data persistence
├── package.json      # Project dependencies
├── .env              # Environment variables (API keys)
├── public/
│   ├── index.html    # Main HTML file
│   ├── style.css     # Styling with glassmorphism
│   └── script.js     # Frontend JavaScript
└── chats.json        # Stored chat messages
```

## License

MIT License

## Made with ❤️ by RKStudios-hub

---

For support and questions, please open an issue on GitHub.
