# Delegate 1

## Introduction

Delegate 1 is a revolutionary single-threaded, single-session, multi-channel AI assistant that provides seamless conversational experiences across multiple communication channels. Unlike traditional AI assistants that handle each interaction in isolation, Delegate 1 maintains a unified conversation thread that spans across different input and output modalities.

### Purpose

The core purpose of Delegate 1 is to create a truly integrated AI assistant that can:

- **Maintain Context Across Channels**: Continue conversations seamlessly whether you're interacting via text, voice, or phone calls
- **Single Session Management**: All interactions are managed within a single, persistent session thread, ensuring conversation continuity and context preservation
- **Multi-Modal Communication**: Support for text-based chat, real-time voice conversations, and traditional phone calls via Twilio integration
- **Real-Time Responsiveness**: Leverage OpenAI's Realtime API for low-latency, natural conversational experiences

### Architecture Overview

Delegate 1 employs a **backend-centric architecture** that centralizes session management and conversation state. This design enables:

#### Single-Threaded Session Management

- All communication channels connect to a single, unified session object
- Conversation history and context are maintained across channel switches
- Real-time event streaming for observability and monitoring

#### Multi-Channel Support

The system supports multiple communication channels:

1. **Text Channel**: Traditional text-based chat interface
2. **Voice Channel**: Real-time voice conversations using WebRTC
3. **Phone Channel**: Traditional phone calls via Twilio integration
4. **API Channel**: Programmatic access for external integrations

#### Technology Stack

- **OpenAI Realtime API**: Core conversational AI capabilities
- **Next.js + TypeScript**: Frontend web application
- **Express.js**: Backend server for session management
- **WebSocket**: Real-time communication between frontend and backend
- **Twilio**: Voice calling infrastructure
- **OpenAI Agents SDK**: Agent orchestration and handoff capabilities

### Reference Implementations

This project builds upon two key reference implementations:

1. **OpenAI Realtime Agents**: Provides the foundation for multi-modal agent interactions with text and voice capabilities
2. **Twilio Demo**: Serves as the primary architectural base, offering a backend-centric, single-session implementation pattern that perfectly aligns with Delegate 1's requirements

The Twilio demo's architecture is particularly valuable as it already demonstrates:

- Centralized session management on the backend
- Multi-connection coordination (Twilio ↔ OpenAI ↔ Frontend)
- Real-time event streaming for observability
- Single session object managing multiple connection types

### Key Benefits

- **Conversation Continuity**: Switch between text, voice, and phone seamlessly without losing context
- **Unified Experience**: One AI assistant that remembers your entire interaction history
- **Real-Time Performance**: Low-latency responses across all communication channels
- **Scalable Architecture**: Backend-centric design supports multiple concurrent sessions
- **Extensible Design**: Easy to add new communication channels or integrate with external systems

### Use Cases

Delegate 1 is designed for scenarios where users need:

- Continuous assistance across different communication preferences
- Context-aware interactions that span multiple sessions
- Professional-grade AI assistance with phone call capabilities
- Real-time collaboration with voice and text integration
- Seamless handoffs between different interaction modalities

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- OpenAI API key
- Twilio account (for phone call functionality)

### Quick Start

The easiest way to get Delegate 1 running is to use our unified startup scripts:

#### Option 1: Using the startup script (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd delegate1

# Install all dependencies
npm run install:all

# Start both frontend and backend servers
./start.sh
```

#### Option 2: Using npm scripts

```bash
# Install dependencies for the root project
npm install

# Install dependencies for both frontend and backend
npm run install:all

# Start both servers in development mode
npm run dev
```

#### Option 3: Manual startup

```bash
# Terminal 1 - Backend (websocket-server)
cd websocket-server
npm install
npm run dev

# Terminal 2 - Frontend (webapp)
cd webapp
npm install
npm run dev
```

### Environment Setup

1. Copy the environment files:

   ```bash
   cp websocket-server/.env.example websocket-server/.env
   cp webapp/.env.example webapp/.env
   cp voice-client/.env.example voice-client/.env
   ```
2. Configure your environment variables:

   - **OpenAI API key**: Required for all AI functionality
   - **Twilio credentials**: Required for phone call functionality
   - **Public URL**: Required for Twilio webhook integration (see Twilio Setup below)

### Twilio Phone Integration Setup

To enable phone call functionality with Twilio, follow these steps:

#### Step 1: Install and Run ngrok

ngrok is required to make your local server accessible to Twilio webhooks:

```bash
# Install ngrok globally (already done if you followed Quick Start)
npm install -g ngrok

# Start your websocket-server first
npm run backend:dev

# In a new terminal, expose your server via ngrok
ngrok http 8081
```

ngrok will provide you with a public URL like: `https://abc123.ngrok.io`

#### Step 2: Configure Environment Variables

Update your `websocket-server/.env` file:

```bash
# Your ngrok URL (without trailing slash)
PUBLIC_URL=https://abc123.ngrok.io

# Your OpenAI API key
OPENAI_API_KEY=your_openai_api_key_here

# Twilio credentials (optional for basic testing)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token

# Optional default number to send SMS to when none is detected
TWILIO_SMS_DEFAULT_TO=+15555555555
```

#### Step 3: Configure Twilio Webhook

1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to **Phone Numbers → Manage → Active numbers**
3. Select your Twilio phone number
4. Set the webhook URL to: `https://your-ngrok-url.ngrok.io/twiml`
5. Set HTTP method to **POST**
6. Save the configuration

### Auto-Update TwiML App after ngrok Restarts

When ngrok gives you a new URL, you can auto-update the TwiML app using the following command:

```bash
npm run script:update-app
```

This script reads `TWILIO_TWIML_APP_SID` and `PUBLIC_URL` from `websocket-server/.env` and sets the TwiML App Voice URL to `${PUBLIC_URL}/twiml` (AU1 region, `edge: sydney`).

Optional custom env path:

```bash
node scripts/twilio/update-twiml-app.js --env path/to/.env
```

### Helper Scripts

Delegate 1 includes a collection of utility scripts for managing Twilio integration and debugging. All scripts are organized in the `/scripts/` directory:

### Quick Commands

```bash
# Generate fresh Twilio access token
npm run script:token

# List all TwiML Applications
npm run script:list-apps

# Inspect current TwiML Application configuration
npm run script:inspect-app

# Debug token issues
npm run script:validate-token
npm run script:test-api-key
```

### Auto-update TwiML App after ngrok restarts

When ngrok gives you a new URL, update `PUBLIC_URL` in `websocket-server/.env`, then run:

```bash
npm run script:update-app
```

The script reads `TWILIO_TWIML_APP_SID` and `PUBLIC_URL` from `websocket-server/.env` and sets the TwiML App Voice URL to `${PUBLIC_URL}/twiml` (AU1 region, `edge: sydney`).

Optional custom env path:

```bash
node scripts/twilio/update-twiml-app.js --env path/to/.env
```

### Script Categories

- **`/scripts/twilio/`** - TwiML Application and token management
- **`/scripts/debug/`** - Debugging and testing utilities

For detailed documentation, see [`scripts/README.md`](scripts/README.md).

#### Step 4: Test Phone Integration

1. **Start all services**:

   ```bash
   npm run dev
   ```
2. **Make a test call**:

   - Call your Twilio phone number
   - The call should connect to your Delegate 1 backend
   - Monitor logs in your frontend or terminal

#### Troubleshooting Twilio Setup

- **ngrok session expired**: Restart ngrok and update your Twilio webhook URL
- **Webhook not receiving calls**: Verify the webhook URL format and HTTP method
- **Connection issues**: Check that your websocket-server is running on port 8081
- **Audio problems**: Ensure your OpenAI API key is valid and has sufficient credits

### Accessing the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8081
- **WebSocket (chat + observability)**: ws://localhost:8081/chat
- **Voice Client**: http://localhost:3001

### Available Scripts

From the root directory:

- `npm run dev` - Start backend, frontend, and voice client in development mode
- `npm run dev:core` - Start only backend and frontend (without voice client)
- `npm run start` - Start both servers in production mode
- `npm run build` - Build backend, frontend, and voice client
- `npm run install:all` - Install dependencies for all projects
- `npm run clean` - Clean all node_modules and build artifacts
- `npm run voice-client:dev` - Start only the voice client
- `./start.sh` - Quick startup script with status messages

### End-to-end tests (Playwright)

These tests exercise the live WebSocket chat flow end-to-end, using real OpenAI endpoints (no mocks). They will be skipped automatically if the backend is not reachable.

Prerequisites:

- Backend running: `ws://localhost:8081` (see `npm run backend:dev`)
- `websocket-server/.env` contains a valid `OPENAI_API_KEY`

Run tests:

```
npm run test:e2e
```

Notes:

- Tests connect to `ws://localhost:8081/chat` and assert behavior from assistant responses. The first test asks for the assistant's name and requires the response to include `HK-47` (the persona is defined in `websocket-server/src/agentConfigs/personality.ts`).
- If you want headed UI for browser tests later, use `npm run test:e2e:headed` (not required for WS-only tests).

### 4. Generate Twilio Access Token

For the voice client to work, you need a Twilio access token:

```bash
# Generate a new access token
node generate-token.js

# Copy the generated token to voice-client/.env
# Update VITE_TWILIO_ACCESS_TOKEN with the new token
```

**⚠️ Important for AU1 Region Users:**
If your Twilio account is in the AU1 (Australia) region, make sure your `generate-token.js` includes the region specification:

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

Without the region specification, you'll get `AccessTokenInvalid (20101)` errors.

### Voice sensitivity and barge‑in (VAD) settings

The phone/voice experience uses OpenAI Realtime with server-side voice activity detection (VAD). You can tune how sensitive it is to user speech and when it interrupts assistant speech ("barge-in").

- Location: `websocket-server/src/session/call.ts`
  - Constants near the top of the file control sensitivity and interruption behavior:

```ts
// Voice Activity Detection (VAD) and Barge-in Configuration
const VAD_TYPE: 'server_vad' | 'semantic_vad' | 'none' = 'server_vad';
const VAD_THRESHOLD: number = 0.6;           // higher = less sensitive
const VAD_PREFIX_PADDING_MS: number = 80;    // speech required before start
const VAD_SILENCE_DURATION_MS: number = 300; // silence required to end
const BARGE_IN_GRACE_MS: number = 300;       // ms of assistant audio before interruption allowed
```

- How it’s applied
  - In `establishRealtimeModelConnection()` we send a `session.update` with `turn_detection` built from those constants.
  - Example payload excerpt (from `call.ts`):

```ts
jsonSend(session.modelConn, {
  type: 'session.update',
  session: {
    modalities: ['text', 'audio'],
    turn_detection: {
      type: VAD_TYPE,
      threshold: VAD_THRESHOLD,
      prefix_padding_ms: VAD_PREFIX_PADDING_MS,
      silence_duration_ms: VAD_SILENCE_DURATION_MS,
    },
    // ...
  },
});
```

- Barge-in grace period
  - In `processRealtimeModelEvent()` we only truncate assistant speech on `input_audio_buffer.speech_started` after at least `BARGE_IN_GRACE_MS` of assistant audio has played. Increase this to reduce abrupt cutoffs; set to `0` for immediate barge-in.

- Runtime overrides via UI (optional)
  - The web UI “Session Settings” dialog sends a `session.update` via the chat WebSocket (`/chat`). The server stores this in `session.saved_config` and merges it into the model session on connect. If you include a `turn_detection` object there, it overrides the constants at runtime.

- Tuning tips
  - Make it less sensitive to background noise: increase `VAD_THRESHOLD` (e.g., 0.7–0.8) and/or `VAD_PREFIX_PADDING_MS` (e.g., 120–200ms).
  - Reduce premature turn endings: increase `VAD_SILENCE_DURATION_MS` (e.g., 400–600ms).
  - Avoid instant barge-in: increase `BARGE_IN_GRACE_MS` (e.g., 500–800ms).
  - If your model version ignores a field, it will be safely ignored by the API.

## Development

[Development guidelines and contribution information will be added here].

## License

[License information will be added here]
