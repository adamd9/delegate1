# Delegate 1 Architecture

## Overview

Delegate 1 is a multi-channel AI assistant that supports both voice and text interactions within a unified conversational session. The architecture uses a **dual implementation approach** that combines raw WebSocket connections for voice (Twilio integration) with the OpenAI Realtime SDK for text chat, all coordinated through a centralized backend session manager.

## Architecture Principles

- **Single-Threaded Session**: All channels (voice, text) share the same conversation context
- **Backend-Centric**: Session state and AI logic managed on the server
- **Multi-Modal**: Seamless switching between voice and text within the same conversation
- **Supervisor-Ready**: Foundation for fast chat + heavy model supervisor pattern
- **Unified Tools**: Same function calling and tool execution across all channels

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                       │
│  ┌─────────────────┐         │         ┌─────────────────┐  │
│  │  Voice Client   │         │         │  Chat Interface │  │
│  │  (Twilio SDK)   │         │         │  (WebSocket)    │  │
│  │                 │         │         │                 │  │
│  │ • Call controls │         │         │ • Text input    │  │
│  │ • Audio stream  │         │         │ • Message UI    │  │
│  └─────────────────┘         │         └─────────────────┘  │
│           │                  │                  │           │
│           │         ┌────────▼────────┐         │           │
│           │         │ Unified         │         │           │
│           │         │ Transcript      │         │           │
│           │         │ & Observability │         │           │
│           │         └─────────────────┘         │           │
└───────────┼──────────────────┼──────────────────┼───────────┘
            │                  │                  │
            │                  │ /logs WebSocket  │
            │                  │ (observability)  │
            │                  │                  │
┌───────────▼──────────────────┼──────────────────▼───────────┐
│                    Backend (Express + WebSocket)            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │           Unified Session Manager                       │ │
│  │  • conversationHistory[]                               │ │
│  │  • agentInstructions                                   │ │
│  │  • toolDefinitions[]                                   │ │
│  │  • currentContext                                      │ │
│  │  • connectionStates                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                              │                              │
│  ┌─────────────────┐         │         ┌─────────────────┐  │
│  │  Voice Handler  │         │         │  Text Handler   │  │
│  │                 │         │         │                 │  │
│  │ Raw WebSocket   │◄────────┼────────►│ OpenAI SDK      │  │
│  │ to OpenAI       │         │         │ (RealtimeAPI)   │  │
│  │ Realtime API    │         │         │                 │  │
│  │                 │         │         │                 │  │
│  │ • Audio streams │         │         │ • Text messages │  │
│  │ • g711_ulaw     │         │         │ • JSON events   │  │
│  │ • VAD enabled   │         │         │ • Text-only     │  │
│  └─────────────────┘         │         └─────────────────┘  │
│           │                  │                  │           │
└───────────┼──────────────────┼──────────────────┼───────────┘
            │                  │                  │
    ┌───────▼───────┐         │         ┌────────▼────────┐
    │ Twilio Voice  │         │         │  Chat WebSocket │
    │   (g711_ulaw) │         │         │    (JSON msgs)  │
    │               │         │         │                 │
    │ /call endpoint│         │         │ /chat endpoint  │
    └───────────────┘         │         └─────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Unified Tool      │
                    │ Execution Engine  │
                    │                   │
                    │ • Weather API     │
                    │ • Database calls  │
                    │ • External APIs   │
                    │ • Function calls  │
                    └───────────────────┘
```

## Core Components

### 1. Frontend (Next.js)

#### Voice Client (`/voice-client`)
- **Technology**: Twilio Voice SDK (WebRTC)
- **Purpose**: Handle voice calls with dynamic token generation
- **Features**:
  - Outgoing call support
  - Real-time audio streaming
  - AU1 region support
  - Dynamic token fetching from backend

#### Chat Interface (`/webapp`)
- **Technology**: React with WebSocket connections
- **Purpose**: Text chat interface with real-time updates
- **Features**:
  - Text input with auto-resize
  - Connection status indicators
  - Unified transcript display
  - Real-time message updates

### 2. Backend (Express + WebSocket)

#### Session Manager (`/websocket-server/src/sessionManager.ts`)
- **Purpose**: Central coordination of all connections and AI logic
- **Responsibilities**:
  - Maintain unified conversation history
  - Route messages between channels and OpenAI
  - Execute function calls and tools
  - Manage connection lifecycle
  - Forward events to observability clients

#### WebSocket Endpoints
- `/call` - Twilio voice connections (raw WebSocket to OpenAI)
- `/chat` - Text chat connections (OpenAI SDK integration)
- `/logs` - Frontend observability (event streaming)

#### REST Endpoints
- `/access-token` - Generate Twilio access tokens
- `/twiml` - Serve TwiML for voice calls
- `/tools` - List available function schemas

### 3. AI Integration

#### Dual OpenAI Connections

**Voice Channel (Raw WebSocket)**:
```typescript
// Direct WebSocket to OpenAI Realtime API
const voiceConnection = new WebSocket(
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
);

// Session configuration for voice
{
  modalities: ["text", "audio"],
  turn_detection: { type: "server_vad" },
  voice: "ballad",
  input_audio_format: "g711_ulaw",
  output_audio_format: "g711_ulaw"
}
```

**Text Channel (OpenAI SDK)**:
```typescript
// OpenAI Realtime SDK
import { RealtimeAPI } from '@openai/realtime-api-beta';

const textSession = new RealtimeAPI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowAPIKeyInBrowser: false
});

await textSession.connect();
textSession.updateSession({
  modalities: ["text"],
  instructions: "You are a helpful assistant."
});
```

## Message Flow

### Voice Message Flow
1. **Twilio Call** → WebSocket (`/call`) → **Session Manager**
2. **Session Manager** → Raw WebSocket → **OpenAI Realtime API**
3. **OpenAI Response** → **Session Manager** → **Twilio** (audio)
4. **Session Manager** → **Frontend** (`/logs`) → **Transcript Update**

### Text Message Flow
1. **Chat Input** → WebSocket (`/chat`) → **Session Manager**
2. **Session Manager** → OpenAI SDK → **OpenAI Realtime API**
3. **OpenAI Response** → **Session Manager** → **Chat Client** (text)
4. **Session Manager** → **Frontend** (`/logs`) → **Transcript Update**

### Unified Context
- Both channels contribute to same `conversationHistory[]`
- Same agent instructions and tool definitions
- Cross-channel context awareness
- Unified function call execution

## Future: Supervisor Agent Architecture

### Two-Tier Model System

**Fast Chat Agent (gpt-4o-realtime)**:
- Handles basic conversations, greetings, parameter collection
- Available to both voice and text channels
- Single tool: `getNextResponseFromSupervisor`

**Heavy Supervisor Agent (gpt-4.1 REST)**:
- Complex reasoning and decision making
- Access to all tools and external APIs
- Called via function call from fast agent
- Returns detailed responses for complex queries

### Supervisor Integration
```typescript
// Fast agent configuration (both channels)
const fastChatAgent = {
  model: "gpt-4o-realtime-preview-2024-12-17",
  instructions: "Handle basic chat, escalate complex queries to supervisor",
  tools: [getNextResponseFromSupervisor]
};

// Supervisor tool implementation
const getNextResponseFromSupervisor = {
  name: 'getNextResponseFromSupervisor',
  execute: async (context) => {
    // Call heavy model via REST API
    const response = await fetch('/api/responses', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: buildSupervisorContext(context),
        tools: allAvailableTools
      })
    });
    return response.nextResponse;
  }
};
```

## Implementation Phases

### Phase 1: Dual Implementation Foundation ✅ COMPLETE
- [x] Raw WebSocket voice integration (Twilio)
- [x] Basic text chat WebSocket endpoint
- [x] Unified session manager
- [x] Frontend chat interface
- [x] ~~OpenAI SDK integration for text~~ **OpenAI REST API integration for text**
- [x] ~~Fix session configuration issues~~ **Fixed session reset bugs and event filtering**

### Phase 2: Enhanced Integration ✅ COMPLETE
- [x] Shared conversation history
- [x] Cross-channel context awareness
- [x] Unified tool execution pipeline
- [x] Improved error handling and logging
- [x] **Session preservation across voice/text handoff**
- [x] **Frontend event filtering to prevent history loss**

### Phase 3: Supervisor Agent Pattern ✅ COMPLETE
- [x] Fast chat agent implementation (gpt-4o for both voice and text)
- [x] Heavy supervisor agent (gpt-4 via REST API)
- [x] Tool-based escalation logic (`getNextResponseFromSupervisor`)
- [x] Context-aware supervisor calls
- [x] **Unified supervisor across voice and text channels**
- [x] **Smart escalation based on query complexity**

### Phase 4: Advanced Features 🚧 AVAILABLE FOR FUTURE
- [x] **Multi-modal responses** (voice and text in same conversation)
- [x] **Advanced observability and analytics** (real-time event streaming)
- [ ] Channel switching mid-conversation (foundation ready)
- [ ] Session persistence (in-memory currently)
- [ ] **Additional reasoning types and tools**
- [ ] **Multi-user session management**

## Configuration

### Environment Variables
```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_TWIML_APP_SID=AP...
TWILIO_AUTH_TOKEN=...

# Server
PORT=8081
PUBLIC_URL=https://your-ngrok-url.ngrok.io
```

### Key Features
- **AU1 Region Support**: Full Twilio AU1 region compatibility
- **Dynamic Token Generation**: Secure, backend-generated Twilio tokens
- **Real-time Observability**: Complete conversation tracking
- **Multi-Channel Session**: Voice and text in same conversation
- **Function Calling**: Unified tool execution across channels
- **Supervisor Ready**: Foundation for advanced agent patterns

## Benefits

1. **Unified Experience**: Seamless voice ↔ text conversation flow
2. **Scalable Architecture**: Easy to add new channels (email, SMS, etc.)
3. **AI Flexibility**: Support for multiple models and reasoning patterns
4. **Real-time Observability**: Complete visibility into agent behavior
5. **Production Ready**: Secure token management and error handling
6. **Future Proof**: Foundation for advanced supervisor agent patterns
