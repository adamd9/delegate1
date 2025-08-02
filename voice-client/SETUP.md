# Quick Setup Guide - Voice Client

## 🚀 Simplified Setup (No Backend Required)

This voice client now works independently without requiring backend changes! Just follow these simple steps:

### Step 1: Get a Twilio Access Token

You need a Twilio access token to use the Voice SDK. Here are the easiest ways to get one:

#### Option A: Generate via Twilio Console (Quickest)
1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to **Develop > Voice > TwiML Apps**
3. Create a new TwiML App (or use an existing one)
4. Go to **Account > API Keys & Tokens**
5. Create an Access Token with Voice grants

#### Option B: Generate Programmatically (Recommended for development)
Create a simple Node.js script to generate tokens:

```javascript
const twilio = require('twilio');

// Your Twilio credentials
const accountSid = 'your_account_sid';
const authToken = 'your_auth_token';
const client = twilio(accountSid, authToken);

// Generate access token
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

const token = new AccessToken(accountSid, 'your_api_key_sid', 'your_api_key_secret');
token.identity = 'voice-client-user';

const voiceGrant = new VoiceGrant({
  outgoingApplicationSid: 'your_twiml_app_sid', // Optional
  incomingAllow: true
});

token.addGrant(voiceGrant);
console.log('Access Token:', token.toJwt());
```

### Step 2: Run the Voice Client

```bash
# From the voice-client directory
npm install
npm run dev

# Or from the root directory
npm run voice-client:dev
```

### Step 3: Test Voice Functionality

1. Open http://localhost:3001
2. Paste your Twilio access token in the input field
3. Click "Initialize Twilio Device"
4. Once connected, click "Start Voice Call"

### Step 4: Configure Call Destination

In the voice client, calls are made to `client:test` by default. You can:

- **Call another Twilio client**: Use `client:username`
- **Call a phone number**: Use `+1234567890` (requires verified numbers in trial)
- **Call a TwiML app**: Configure your TwiML app to handle incoming calls

### 🔧 Customization

To change the call destination, edit `main.js`:

```javascript
// In the startCall() method, change:
const params = {
    To: 'client:test', // Change this to your desired destination
    From: 'voice-client'
};
```

### 📱 Testing Scenarios

1. **Self-test**: Create two browser tabs, both with different client identities
2. **Phone test**: Call a verified phone number (trial accounts have restrictions)
3. **TwiML test**: Set up a TwiML app that responds with `<Say>` or `<Play>`

### 🎯 Next Steps

Once you've tested the basic voice functionality:
1. Integrate with your Delegate 1 backend
2. Add conversation handling
3. Implement session management
4. Add real-time transcription

### 🆘 Troubleshooting

- **"Token Required" error**: Make sure you've entered a valid access token
- **"Device Registration Failed"**: Check your Twilio account status and token validity
- **"Call Failed"**: Verify the destination format and your account permissions
- **No audio**: Check browser microphone permissions

### 💡 Pro Tips

- Access tokens expire! Generate fresh ones for extended testing
- Use the browser's developer console for additional debugging
- The voice client logs all events in real-time for easy troubleshooting
