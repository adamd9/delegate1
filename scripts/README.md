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

### `ask.js` - End-to-end agent test
- **`ask.js`** - Run a question through the full agent pipeline from the command line

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

### Auto-Update DEV TwiML Application after ngrok restart
```bash
# Ensure websocket-server/.env has PUBLIC_URL and TWILIO_TWIML_APP_SID set
# Example: PUBLIC_URL=https://<your-ngrok>.ngrok-free.app

# Run the updater (reads websocket-server/.env)
npm run script:update-app

# Optional: specify a custom .env path
node scripts/twilio/update-twiml-app.js --env path/to/.env
```

This will set the TwiML App Voice URL to `${PUBLIC_URL}/twiml` using AU1 region (`edge: sydney`).

### Debug Token Issues
```bash
npm run script:validate-token
npm run script:test-api-key
```

### Run an End-to-End Agent Test
```bash
npm run ask -- "What is 2 + 2?"      # simple flow
npm run ask -- "Please escalate this to the supervisor and tell me our company policy on data privacy."  # escalation
```

## 📋 Prerequisites

Make sure you have the following environment variables configured:

### For Backend (websocket-server/.env):
```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_TWIML_APP_SID=AP...
PUBLIC_URL=https://<your-ngrok>.ngrok-free.app
```

### For Scripts:
- Scripts now read from `websocket-server/.env` where applicable (e.g., update-twiml-app).
- Install once at repo root: `npm install dotenv`.
- For production, migrate secrets to environment variables or a secret manager.

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
