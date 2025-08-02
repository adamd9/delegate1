# Delegate 1 - Voice Client

A lightweight Twilio Voice WebRTC client for testing voice functionality with the Delegate 1 backend without requiring a Twilio phone number.

## Overview

This voice client uses the Twilio Voice JavaScript SDK to establish WebRTC connections directly to your Delegate 1 backend. It's perfect for development and testing scenarios where you want to test voice functionality without setting up phone numbers or webhooks.

## Features

- **WebRTC Voice Calls**: Direct browser-to-backend voice communication
- **Real-time Connection Status**: Visual feedback on connection and call states
- **Live Logging**: Real-time logs of all voice events and backend communication
- **Simple UI**: Clean, modern interface for easy testing
- **Backend Integration**: Seamless integration with Delegate 1's websocket-server

## Quick Start

### Prerequisites

- Node.js (v18 or higher)
- Running Delegate 1 backend (websocket-server)
- Twilio account with Voice SDK capabilities

### Installation

```bash
# From the voice-client directory
npm install

# Or from the root directory
npm run install:all
```

### Configuration

1. Copy the environment file:
   ```bash
   cp .env.example .env
   ```

2. Configure your backend URL in `.env` (optional, defaults to `ws://localhost:8080`)

### Running

```bash
# Start the voice client (runs on port 3001)
npm run dev

# Or from the root directory (starts all services)
npm run dev
```

### Usage

1. **Connect to Backend**: Click "Connect to Backend" to establish WebSocket connection
2. **Start Voice Call**: Once connected, click "Start Voice Call" to initiate WebRTC call
3. **Monitor Logs**: Watch the real-time logs for connection status and events
4. **Hang Up**: Click "Hang Up" to end the call

## Architecture

```
Voice Client (Browser) 
    ↓ WebSocket
Backend (websocket-server)
    ↓ Twilio Voice API
Twilio Infrastructure
    ↓ WebRTC
Voice Client (Browser)
```

The voice client:
1. Connects to your backend via WebSocket
2. Requests a Twilio access token from the backend
3. Initializes the Twilio Device with the token
4. Generate a Twilio access token:
   ```bash
   # From the root directory
   node generate-token.js
   
   # Copy the generated token to your .env file
   # Update VITE_TWILIO_ACCESS_TOKEN with the token
   ```

   **⚠️ Important for AU1 Region Users:**
   If your Twilio account is in the AU1 (Australia) region, ensure your `generate-token.js` includes the region specification:
   
   ```javascript
   const token = new AccessToken(
     config.accountSid,
     config.apiKeySid, 
     config.apiKeySecret,
     { 
       identity: config.identity,
       region: 'au1'  // Critical for AU1 region accounts
     }
   );
   ```
Makes WebRTC calls that route through your backend

## Integration with Backend

The voice client expects your backend to handle these WebSocket message types:

### Outgoing Messages (Client → Backend)
```javascript
// Request access token
{
  type: 'request_access_token',
  clientName: 'voice-client-timestamp'
}
```

### Incoming Messages (Backend → Client)
```javascript
// Access token response
{
  type: 'access_token',
  token: 'twilio-access-token'
}

// Call status updates
{
  type: 'call_status',
  status: 'connected|disconnected|ringing'
}

// Error messages
{
  type: 'error',
  message: 'Error description'
}
```

## Development

### File Structure
```
voice-client/
├── index.html          # Main UI
├── main.js            # Voice client logic
├── package.json       # Dependencies and scripts
├── vite.config.js     # Vite configuration
├── .env.example       # Environment template
└── README.md          # This file
```

### Key Components

- **VoiceClient Class**: Main class handling Twilio Device and WebSocket connections
- **UI Management**: Real-time status updates and logging
- **Event Handling**: Comprehensive event handling for calls and connections
- **Error Handling**: Robust error handling with user feedback

## Troubleshooting

### Common Issues

1. **Connection Failed**: Ensure your backend is running on the correct port
2. **Device Registration Failed**: Check your Twilio credentials in the backend
3. **Call Not Connecting**: Verify your backend's Twilio webhook configuration
4. **Audio Issues**: Check browser microphone permissions

### Debug Logs

The voice client provides detailed logging for:
- WebSocket connection events
- Twilio Device registration
- Call state changes
- Error conditions

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

WebRTC support is required for voice functionality.

## Security Notes

- Access tokens are requested dynamically from your backend
- No Twilio credentials are stored in the client
- WebSocket connections should use WSS in production
- Consider implementing authentication for production use
