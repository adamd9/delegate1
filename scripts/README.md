# Delegate 1 Helper Scripts

This directory contains utility scripts for managing Twilio Voice integration and debugging.

## 📁 Directory Structure

### `/twilio/` - Twilio Management Scripts
- **`generate-token.js`** - Generate Twilio access tokens with AU1 region support
- **`create-twiml-app.js`** - Create new TwiML Applications for voice calling
- **`list-twiml-apps.js`** - List all TwiML Applications in your account
- **`update-twiml-app.js`** - Update TwiML Application voice URL for backend integration
- **`inspect-twiml-app.js`** - Inspect TwiML Application configuration and test voice URL

### `/debug/` - Debugging & Testing Scripts
- **`test-api-key.js`** - Test Twilio API Key credentials and permissions
- **`test-direct-api.js`** - Test direct HTTP API calls to Twilio AU1 region
- **`validate-token.js`** - Decode and validate Twilio access tokens

## 🚀 Quick Usage

### Generate a Fresh Token
```bash
npm run script:token
```

### List TwiML Applications
```bash
npm run script:list-apps
```

### Inspect Current TwiML Application
```bash
npm run script:inspect-app
```

### Debug Token Issues
```bash
npm run script:validate-token
npm run script:test-api-key
```

## 📋 Prerequisites

Make sure you have the following environment variables configured:

### For Backend (websocket-server/.env):
```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_TWIML_APP_SID=AP...
```

### For Scripts:
Scripts read credentials directly from the code (for development convenience).
In production, these should be moved to environment variables.

## 🔧 Manual Usage

You can also run scripts directly:

```bash
# From project root
node scripts/twilio/generate-token.js
node scripts/twilio/list-twiml-apps.js
node scripts/debug/validate-token.js
```

## 🛡️ Security Notes

- Scripts contain hardcoded credentials for development convenience
- For production use, migrate to environment variables
- Never commit real credentials to version control
- Use `.env` files and `.gitignore` for sensitive data
