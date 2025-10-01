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

### Runtime data persistence (Docker/K8s)

Development defaults write runtime data inside the repo, which persists locally between runs:

- Notes: `websocket-server/runtime-data/notes.json`
- SQLite DB: `websocket-server/runtime-data/db/assistant.sqlite`

In containerized deployments, the container filesystem is ephemeral. To persist data across restarts, mount a volume and configure paths using environment variables:

- `RUNTIME_DATA_DIR`: Base directory for runtime data (recommended). If set, defaults become:
  - Notes at `${RUNTIME_DATA_DIR}/notes.json`
  - SQLite DB at `${RUNTIME_DATA_DIR}/db/assistant.sqlite`
- `SESSION_HISTORY_LIMIT`: Number of past conversations returned by the API/WS replay (default 3, max 50). Increase in production if you want to see more history by default.

Example Docker Compose service:

```yaml
services:
  websocket-server:
    image: your-org/delegate1-websocket-server:latest
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - RUNTIME_DATA_DIR=/runtime-data
      - SESSION_HISTORY_LIMIT=20
    volumes:
      - ./data/runtime-data:/runtime-data
    ports:
      - "8081:8081"
```

Example Kubernetes (conceptual):

- Create a PersistentVolumeClaim and mount it at `/runtime-data`.
- Set `RUNTIME_DATA_DIR=/runtime-data` in env.
- Optionally set `SESSION_HISTORY_LIMIT=20`.

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
- Install Playwright browsers (one-time):

  ```bash
  npx playwright install chromium
  ```

Run tests:

```
npm run test:e2e
```

Notes:

- Tests connect to `ws://localhost:8081/chat` and assert behavior from assistant responses. The first test asks for the assistant's name and requires the response to include `HK-47` (the persona is defined in `websocket-server/src/agentConfigs/personality.ts`).
- If you want headed UI for browser tests later, use `npm run test:e2e:headed` (not required for WS-only tests).

#### UI E2E test (browser)

- Start both servers:

  ```bash
  npm run backend:dev
  npm run frontend:dev
  ```

- Install browsers once (if not already):

  ```bash
  npx playwright install chromium
  ```

- Run only the UI test (headless):

  ```bash
  npm run test:e2e -- tests/e2e/ui-notes.spec.ts
  ```

- Run headed (watch the browser):

  ```bash
  npm run test:e2e:headed -- tests/e2e/ui-notes.spec.ts
  ```

Environment overrides (optional):

```bash
FRONTEND_PORT=3001 PORT=8082 npm run test:e2e -- tests/e2e/ui-notes.spec.ts
```

Note: If TypeScript complains about Node globals in tests, install Node types in the root dev deps:

```bash
npm i -D @types/node
```

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

## Remote MCP servers (Model Context Protocol)

Delegate 1 can discover and use tools exposed by remote MCP servers via the MCP Streamable HTTP transport. Discovered MCP tools are made available to the supervisor agent automatically and can be called like any other function tool.

### Where configuration lives

- File path (created on first use): `websocket-server/runtime-data/mcp-servers.json`
- Shape: a JSON array of MCP server descriptors
- Supported `type` values: only `"streamable-http"` is supported at the moment

The backend will create `runtime-data/mcp-servers.json` if it does not exist and default it to `[]`.

### JSON schema

Each entry must follow this shape (validated by `websocket-server/src/config/mcpConfig.ts`):

```jsonc
[
  {
    "type": "streamable-http",        // required; only this type is supported currently
    "url": "https://host.example/mcp", // required; full URL of MCP Streamable HTTP endpoint
    "name": "my-mcp",                  // required; unique server name used for namespacing
    "headers": {                        // optional; custom headers sent to the MCP server
      "Authorization": "Bearer <token>",
      "X-Custom": "value"
    }
  }
]
```

If the JSON is invalid or any required field is missing, the server will reject the update with a helpful error message.

### How discovery and registration work

- On startup and whenever the config changes, the backend runs MCP discovery:
  - Code: `websocket-server/src/tools/mcp/adapter.ts` → `initMCPDiscovery()` → `performDiscovery()`
  - It loads servers via `getMcpConfig()` from `websocket-server/src/config/mcpConfig.ts`.
  - For each server, it connects using `@modelcontextprotocol/sdk`’s Streamable HTTP client (`client.ts`).
  - It lists tools and converts them to OpenAI function-style schemas.
  - Tool names are namespaced as `mcp.{serverName}.{toolName}`.
  - All discovered tools are injected into the supervisor agent via `updateSupervisorMcpTools()`.
- After discovery, the central tools registry is rebuilt so the supervisor is allowed to call these tools.

Relevant files:

- `websocket-server/src/config/mcpConfig.ts` (JSON read/validate/write)
- `websocket-server/src/server/routes/mcpConfig.ts` (REST API to view/update config; triggers reload)
- `websocket-server/src/tools/mcp/client.ts` (connect/list/call remote tools)
- `websocket-server/src/tools/mcp/adapter.ts` (discovery, namespacing, and registration)
- `websocket-server/src/server/startup/init.ts` (startup + reload sequence)
- `websocket-server/src/agentConfigs/supervisorAgentConfig.ts` (wires discovered tools to the supervisor)

### Managing MCP servers at runtime (no restart required)

The backend exposes a small REST API to manage the JSON config. After a successful update, discovery is forced and the registry is rebuilt automatically.

- GET `http://localhost:8081/api/mcp/config`
  - Response: `{ text: string, servers: RemoteServerConfig[] }`
- POST `http://localhost:8081/api/mcp/config`
  - Body: `{ "text": "<raw JSON string>" }`
  - Validates JSON, writes to `runtime-data/mcp-servers.json`, forces rediscovery, and returns `{ status: 'updated', servers }`.

Example using curl:

```bash
# Read current config
curl -s http://localhost:8081/api/mcp/config | jq .

# Update config (inline JSON)
curl -s -X POST http://localhost:8081/api/mcp/config \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "[{\n  \"type\": \"streamable-http\",\n  \"url\": \"https://host.example/mcp\",\n  \"name\": \"my-mcp\",\n  \"headers\": {\n    \"Authorization\": \"Bearer sk-example\"\n  }\n}]"
  }' | jq .
```

Notes:

- The route is unauthenticated in development; if you expose the backend publicly, put it behind auth or a network boundary.
- Only `streamable-http` servers are supported at this time.
- Headers are forwarded as provided to the MCP server on connect/calls. Avoid committing secrets to source control; prefer injecting tokens via your deployment’s secret management and updating the JSON through the POST endpoint at runtime.
- Server metadata such as name/description/version is obtained from the MCP server during initialization (`initialize` result’s `serverInfo`). Any description/note fields in the JSON config are ignored.

### Example configuration

Save the following to `websocket-server/runtime-data/mcp-servers.json` or POST it via the REST API.

```json
[
  {
    "type": "streamable-http",
    "url": "https://mcp.tools.yourcompany.com/api/mcp",
    "name": "corp-tools",
    "headers": {
      "Authorization": "Bearer ${MCP_CORP_TOOLS_TOKEN}"
    }
  },
  {
    "type": "streamable-http",
    "url": "https://public.example/mcp",
    "name": "public-demo",
    "headers": {
      "X-Env": "demo"
    }
  }
]
```

After saving, watch the backend logs for lines like:

```
[startup] MCP discovery initialized
[mcpAdapter] MCP discovery complete. 7 tool(s) registered.
```

### Calling MCP tools

When the supervisor decides to use a tool, it will see names like `mcp.corp-tools.search` or `mcp.public-demo.fetch`. You can also trigger them via the function-calling path programmatically by referring to their namespaced schema names.

## Agent Tool Policies (Allow Lists)

Delegate 1 uses a centralized tools registry that allows you to control which tools each agent can access. Agent policies define "allow lists" that filter the available tools from the catalog.

### How it works

- **Code-defined defaults**: Each agent config (e.g., `websocket-server/src/agentConfigs/baseAgent.ts`) defines default tools
- **Runtime overrides**: You can modify tool allow lists via the webapp UI at `/settings?tab=catalog`
- **Persistent storage**: Changes are saved to `websocket-server/runtime-data/agent-policies.json`
- **Merge behavior**: On startup, persisted policies override code defaults

### Policy structure

Each agent has a policy with two filter mechanisms:

```typescript
{
  "allowNames": ["tool_name_1", "tool_name_2"],  // Explicit tool names
  "allowTags": ["supervisor-allowed", "base-default"]  // Tool tags
}
```

- **`allowNames`**: Explicit list of tool names (e.g., `"create_note"`, `"mcp.real-browser.anchor_navigate"`)
- **`allowTags`**: Tags that tools are registered with (e.g., `"supervisor-allowed"` for web_search)

A tool is available to an agent if it matches **either** an allowed name **or** an allowed tag.

### Managing policies via webapp

1. Navigate to **Settings → Tools** in the webapp
2. Scroll to the agent section (e.g., "Supervisor Agent")
3. Use the dropdown to add tools to the allow list
4. Click **"Save allow list"**
5. Changes persist to `runtime-data/agent-policies.json`

### Managing policies programmatically

**GET `/agents/:id/policy`** - View current policy (via `/agents` endpoint)

```bash
curl -s http://localhost:8081/agents | jq '.supervisor.policy'
```

**PATCH `/agents/:id/policy`** - Update policy

```bash
curl -X PATCH http://localhost:8081/agents/supervisor/policy \
  -H 'Content-Type: application/json' \
  -d '{
    "allowNames": ["create_note", "mcp.real-browser.anchor_navigate"],
    "allowTags": ["supervisor-allowed"]
  }'
```

### Persistence location

- **File**: `websocket-server/runtime-data/agent-policies.json`
- **Format**: JSON object mapping agent IDs to policies
- **Docker/K8s**: Respects `RUNTIME_DATA_DIR` environment variable

Example `agent-policies.json`:

```json
{
  "base": {
    "allowNames": ["get_weather", "escalate_to_supervisor"],
    "allowTags": ["base-default"]
  },
  "supervisor": {
    "allowNames": ["create_note", "mcp.real-browser.anchor_navigate"],
    "allowTags": ["supervisor-allowed"]
  }
}
```

### Important notes

- **MCP tools are NOT auto-allowed**: Discovered MCP tools must be explicitly added to the allow list
- **Builtin tools use tags**: Tools like `web_search` are tagged with `supervisor-allowed` and included via `allowTags`
- **Restart behavior**: Persisted policies override code defaults on server restart
- **No policy file**: If the file doesn't exist, agents use their code-defined defaults

## Catalog and Agent Tooling Endpoints

These debug/inspection endpoints expose the canonical tools catalog and the agent-specific tool visibility as assembled by the centralized registry in `websocket-server/src/tools/registry.ts` and mounted in `websocket-server/src/server/routes/catalog.ts`.

- **GET `/tools`**
  - Back-compat list of raw function schemas from `websocket-server/src/functionHandlers.ts` (which delegates to `agentConfigs`).
  - Example:
    ```bash
    curl -s http://localhost:8081/tools | jq .
    ```

- **GET `/catalog/tools`**
  - Canonical tools catalog with metadata from the centralized registry (local, MCP, and built-ins).
  - Fields: `id`, `name`, `sanitizedName`, `origin`, `tags`, `description`.
  - Example:
    ```bash
    curl -s http://localhost:8081/catalog/tools | jq .
    ```

- **GET `/agents`**
  - Agents debug view with exposure policies and resolved tool names.
  - Example:
    ```bash
    curl -s http://localhost:8081/agents | jq .
    ```

- **GET `/agents/:id/tools`**
  - Tools available to a specific agent in OpenAI Responses API "tools" format.
  - For built-ins (e.g., web search), entries look like `{ "type": "web_search" }`.
  - For functions, entries look like `{ "type": "function", "name": "<sanitizedName>", "description": "...", "parameters": { ... }, "strict": false }`.
  - Example (replace `supervisor` with your agent id):
    ```bash
    curl -s http://localhost:8081/agents/supervisor/tools | jq .
    ```

Notes:

- These endpoints are intended for development/observability. If you expose the backend publicly, secure them appropriately.
- MCP tools are discovered at startup and after successful updates via `POST /api/mcp/config` (see section above). The catalog reflects the current registry state without needing a server restart.

## Development

[Development guidelines and contribution information will be added here].

## License

[License information will be added here]
