# Ava - WhatsApp Client with AI Assistant

Ava is your personal WhatsApp assistant that brings the power of AI to your messaging. Whether you need help replying to messages quickly, want toformalize your texts, or just need an intelligent assistant to handle your chats, Ava has got you covered.

<img width="920" height="780" alt="Personal info" src="https://github.com/user-attachments/assets/4829fc3e-ef47-49a6-8cc1-66a60123fb2e" />

<img width="920" height="780" alt="2" src="https://github.com/user-attachments/assets/a9192e4a-76a9-48b8-97da-0cc6850fde5f" />

## What is Ava?

Ava is a web-based WhatsApp assistant that connects to your WhatsApp account and uses AI to help you manage your messages smarter. Think of it as having a smart secretary who can help draft replies, clean up your grammar, or even auto-respond when you're busy.

## Why Use Ava?

- **Save Time**: Let AI help draft responses quickly
- **Professional Messages**: Convert casual Hinglish to polished English
- **Auto-Reply**: Set AI to respond when you can't
- **Beautiful Interface**: Clean, modern UI that feels like WhatsApp
- **Your Style**: Train Ava with your personal information

## What's Inside?

- **3 AI Modes**: Manual (you control), Semi-AI (fixes grammar), Auto-AI (auto-responds)
- **4 Themes**: Kawaii, Royal Dark, Catppuccin Mocha, Frappe
- **Media Support**: Send images, videos, audio, documents
- **Real-time Sync**: Messages update instantly
- **Message Delete**: Delete for yourself or everyone

## How to Run

### 1. Get Requirements Ready

- **Node.js**: Download from nodejs.org (version 18 or higher)
- **WhatsApp Account**: Your regular WhatsApp on phone
- **Groq API Key**: Free key from https://console.groq.com

### 2. Setup

```bash
# Clone the project
git clone https://github.com/RKStudios-hub/AvaMessanger.git
cd AvaMessanger

# Install dependencies
npm install
```

### 3. Configure

Create a `.env` file in the project folder:

```env
PORT=3001
GROQ_API_KEY=your_groq_api_key_here
AI_TRAINING=Your name is [Your Name], you communicate professionally
AI_SCHEDULE=
```

Get your free Groq API key:

1. Go to https://console.groq.com
2. Sign up/Login
3. Click "Create API Key"
4. Copy and paste it in your .env file

### 4. Run

```bash
npm start
```

### 5. Connect WhatsApp

1. Open browser to http://localhost:3001
2. Scan the QR code with your WhatsApp phone app
3. You're connected!

## How to Use

### AI Modes

- **Manual**: Type and send normally
- **Semi-AI**: Your message gets grammar-checked and formalized before sending
- **Auto-AI**: AI reads incoming messages and replies automatically based on your training

### Settings

Click the settings icon to:

- Add your Groq API key
- Train AI with your info (name, style, etc.)
- Set your daily schedule for smart replies
- Change theme

## Tech Details

### APIs Used

- **WPPConnect**: For WhatsApp Web connection
- **Groq LLM API**: For AI responses (LLaMA 3.1 model)
- **DiceBear API**: For avatar images

### Built With

- Node.js + Express (Backend)
- Vanilla JavaScript (Frontend)
- CSS3 with Glassmorphism
- WebSocket (Real-time updates)

## Troubleshooting

**Messages not sending?**

- Check your Groq API key is valid
- Make sure WhatsApp is connected

**AI not responding?**

- Verify API key in Settings
- Check internet connection

**Need to reconnect?**

- Delete the `tokens` folder and restart

## Credits

**Made by**: RKStudios-hub

Built with ❤️ using open-source tools.

---

For bugs or feature requests: https://github.com/RKStudios-hub/AvaMessanger/issues

*Use responsibly. This project is for personal use only and complies with WhatsApp's Terms of Service.*
