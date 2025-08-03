# OpenAI Responses API vs Chat Completions API Migration Guide

## Overview

OpenAI introduced the Responses API as a successor to Chat Completions API, combining the best of Chat Completions and Assistants APIs. This document outlines the key differences and migration strategy for Delegate 1.

## Key Differences

### 1. API Endpoint & Structure

**Chat Completions API:**
```typescript
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" }
  ],
  functions: functionSchemas,
  function_call: "auto",
  max_tokens: 500,
  temperature: 0.7
});

// Access response
const message = completion.choices[0]?.message;
```

**Responses API:**
```typescript
const response = await client.responses.create({
  model: "gpt-4o",
  input: {
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" }
    ]
  },
  tools: functionSchemas.map(schema => ({
    type: "function",
    name: schema.name,
    parameters: schema.parameters,
    strict: true
  })),
  max_output_tokens: 500,
  temperature: 0.7
});

// Access response
const message = response.output[0]?.content;
```

### 2. Parameter Changes

| Chat Completions | Responses API | Notes |
|------------------|---------------|-------|
| `messages: []` | `input: { messages: [] }` | Messages wrapped in input object |
| `functions: []` | `tools: []` | Different tool schema format |
| `function_call: "auto"` | *automatic* | Tool calling is automatic |
| `max_tokens` | `max_output_tokens` | Parameter renamed |
| `choices[0].message` | `output[0].content` | Different response structure |

### 3. Tool/Function Calling

**Chat Completions Format:**
```typescript
functions: [{
  name: "get_weather",
  description: "Get weather info",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"]
  }
}]
```

**Responses API Format:**
```typescript
tools: [{
  type: "function",
  name: "get_weather",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"]
  },
  strict: true
}]
```

### 4. Built-in Tools (Responses API Only)

The Responses API includes built-in tools:
- `web_search_preview` - Real-time web search
- `file_search` - Vector store/RAG integration  
- `computer_use_preview` - Computer interaction capabilities

### 5. Conversation State Management

**Chat Completions (Manual State):**
- Must maintain full conversation history
- Send complete message array with each request
- Manual tool result handling

**Responses API (Optional Server State):**
- Can use `store: true` for server-side state management
- Use `previous_response_id` to continue conversations
- Automatic tool orchestration

## Migration Strategy for Delegate 1

### Phase 1: Simple Text Chat ✅ (In Progress)
- **File**: `sessionManager.ts` - `handleTextChatMessage()`
- **Status**: Migrating basic text responses
- **Complexity**: Low - no complex function calling

### Phase 2: Supervisor Agent Function Calling
- **File**: `agentConfigs/supervisorAgent.ts`
- **Status**: Pending
- **Complexity**: Medium - preserve manual orchestration for observability
- **Note**: Keep manual tool calling loop to maintain breadcrumb functionality

### Phase 3: Built-in Tools Integration
- **Status**: Future
- **Complexity**: Low-Medium
- **Options**: Replace custom functions with built-in web search, file search

## Current Implementation Status

### ✅ Completed
- Agent configuration refactoring
- Project structure cleanup

### 🔄 In Progress  
- Simple text chat migration (sessionManager.ts)
- TypeScript type fixes for Responses API

### ⏳ Pending
- Supervisor agent migration
- Response structure updates
- Built-in tools evaluation

## Important Notes

### Preserving Frontend Compatibility
- **Requirement**: Don't break existing frontend/observability code
- **Strategy**: Keep response parsing compatible with current structure
- **Impact**: May need response transformation layer

### Voice Channel (Unchanged)
- **OpenAI Realtime API**: Separate from both Chat Completions and Responses APIs
- **Status**: No changes needed
- **Reason**: Uses WebSocket connection, different protocol entirely

### Manual vs Automatic Orchestration
- **Current**: Manual function calling with breadcrumb logging
- **Responses API**: Automatic orchestration available
- **Decision**: Keep manual approach initially to preserve observability

## Migration Checklist

- [ ] Fix TypeScript errors in sessionManager.ts
- [ ] Update response parsing to handle Responses API structure
- [ ] Test simple text chat functionality
- [ ] Migrate supervisor agent while preserving manual orchestration
- [ ] Evaluate built-in tools vs custom functions
- [ ] Update documentation and examples

## References

- [OpenAI Responses vs Chat Completions Guide](https://platform.openai.com/docs/guides/responses-vs-chat-completions)
- [Simon Willison's Analysis](https://simonwillison.net/2025/Mar/11/responses-vs-chat-completions/)
- [OpenAI Python SDK Migration Commit](https://github.com/openai/openai-python/commit/2954945ecc185259cfd7cd33c8cbc818a88e4e1b)
