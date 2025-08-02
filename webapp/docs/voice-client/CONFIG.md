# Voice Client Configuration Reference

> **Note**: The voice client is now integrated into the webapp. This configuration reference is for understanding the integration.

## Environment Variables (Legacy)

The standalone voice client used these environment variables (now handled by the integrated webapp):

```bash
# Backend WebSocket URL (usually ws://localhost:8080 for development)
VITE_BACKEND_WS_URL=ws://localhost:8080

# Optional: Custom client name prefix
VITE_CLIENT_NAME_PREFIX=voice-client
```

## Integrated Configuration

The integrated voice client in the webapp uses:

### Default Backend URL
- Default: `http://localhost:8081`
- Configurable via UI input field
- Used for `/access-token` endpoint requests

### Client Identity
- Automatically generated: `voice-client-${timestamp}`
- Unique for each connection session
- Handled by backend token generation

### Twilio Device Configuration

```javascript
const device = new Device(accessToken, {
  logLevel: 1,
  codecPreferences: ['opus', 'pcmu']
});
```

### Call Parameters

```javascript
const params = {
  To: 'client:test', // Configurable call destination
  From: 'voice-client'
};
```

## Backend Integration Points

### Token Request
```javascript
POST /access-token
Content-Type: application/json

{
  "clientName": "voice-client-1234567890"
}
```

### Token Response
```javascript
{
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "identity": "voice-client-1234567890",
  "message": "Access token generated successfully"
}
```

## UI Configuration

The integrated voice client provides:
- Backend URL input field
- Real-time status display
- Connection/disconnection controls
- Call/hangup buttons
- Live logging panel

## Migration Notes

- Environment variables are no longer needed
- Token generation moved to secure backend
- UI rebuilt as React component with Tailwind CSS
- All functionality preserved and enhanced
