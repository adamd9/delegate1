# Voice Client Setup Guide (Integrated)

> **Note**: The voice client is now integrated into the main webapp at `/voice`. This setup guide has been updated for the integrated version.

## 🚀 Quick Setup

The voice client is now part of the main webapp and uses dynamic token generation from the backend. No manual token configuration required!

### Prerequisites

1. **Running Backend**: Ensure the websocket-server is running on port 8081
2. **Twilio Credentials**: Backend must be configured with valid Twilio credentials
3. **Webapp Running**: Start the webapp with `npm run dev`

### Access the Voice Client

1. Navigate to: `http://localhost:3000/voice`
2. Enter backend URL (default: `http://localhost:8081`)
3. Click "Initialize Twilio Device"
4. The client will automatically request a fresh token from the backend

## Backend Token Generation

The integrated voice client uses the backend's `/access-token` endpoint for secure, dynamic token generation. The backend handles:

- Twilio API Key authentication
- AU1 region support (for Australian accounts)
- Unique client identity generation
- Proper Voice SDK grants configuration

## Manual Token Generation (Development/Testing)

If you need to generate tokens manually for testing, use the scripts in `/scripts/twilio/`:

```bash
# Generate a fresh access token
node scripts/twilio/generate-token.js
```

### Token Generation Script Example

```javascript
const twilio = require('twilio');

// Your Twilio credentials
const accountSid = 'your_account_sid';
const apiKeySid = 'your_api_key_sid';
const apiKeySecret = 'your_api_key_secret';

// Generate access token with AU1 region support
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

const token = new AccessToken(
  accountSid, 
  apiKeySid, 
  apiKeySecret,
  { 
    identity: 'voice-client-user',
    region: 'au1'  // Important for AU1 region accounts
  }
);

const voiceGrant = new VoiceGrant({
  outgoingApplicationSid: 'your_twiml_app_sid',
  incomingAllow: true
});

token.addGrant(voiceGrant);
console.log('Access Token:', token.toJwt());
```

## Troubleshooting

### Common Issues

1. **Backend Connection Failed**
   - Ensure websocket-server is running on the specified port
   - Check backend logs for token generation errors
   - Verify Twilio credentials in backend configuration

2. **AccessTokenInvalid (20101)**
   - For AU1 region accounts, ensure `region: 'au1'` is set in token generation
   - Verify API Key credentials are correct
   - Check token expiration (tokens are valid for 1 hour)

3. **Device Registration Failed**
   - Check browser console for WebRTC errors
   - Ensure microphone permissions are granted
   - Verify network connectivity

### AU1 Region Accounts

Australian Twilio accounts require special region configuration:

```javascript
// In token generation
const token = new AccessToken(
  accountSid,
  apiKeySid,
  apiKeySecret,
  { 
    identity: clientName,
    region: 'au1'  // Critical for AU1 accounts
  }
);
```

## Testing Voice Calls

1. **Outbound Calls**: Modify the call destination in the voice client
2. **Inbound Calls**: Configure TwiML Application webhook to point to your backend
3. **Client-to-Client**: Use `client:name` format for calling other connected clients

## Integration Benefits

- ✅ **Secure Token Management**: No hardcoded tokens in frontend
- ✅ **Automatic Refresh**: Fresh tokens generated on each connection
- ✅ **Unified Interface**: Voice functionality integrated with main webapp
- ✅ **Production Ready**: Proper error handling and logging
- ✅ **Region Support**: Built-in AU1 region compatibility
