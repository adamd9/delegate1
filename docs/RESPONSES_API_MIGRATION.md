# Migrating from Chat Completions API to Responses API (Quick Reference)

This is a condensed guide for migrating agents from the **Chat Completions API** to the **Responses API**.

## 1. Endpoint Change
**From:**
```
POST https://api.openai.com/v1/chat/completions
```
**To:**
```
POST https://api.openai.com/v1/responses
```

## 2. Request Parameter Changes

| Chat Completions API         | Responses API                                      |
|------------------------------|----------------------------------------------------|
| `messages`: array of `{ role, content }` | `input`: user message(s) (string or array) |
| System prompt as first `messages` entry | `instructions`: system-level prompt         |
| `functions` / `tools` (custom)         | `tools` (same format for custom, plus built-ins) |
| No conversation state            | `store: true` + `previous_response_id` for multi-turn |
| `max_tokens`                     | `max_output_tokens`                           |

**Example (Before):**
```ts
const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" }
  ]
});
```

**Example (After):**
```ts
const response = await openai.responses.create({
  model: "gpt-4.1",
  instructions: "You are a helpful assistant.",
  input: "Hello!"
});
```

## 3. Response Parsing Changes

| Chat Completions API                       | Responses API                       |
|---------------------------------------------|---------------------------------------|
| `response.choices[0].message.content`       | `response.output_text`                |
| Tool calls in `message.tool_calls`          | Tool calls in `response.output` array (type=`function_call`) |
| No built-in conversation tracking           | `previous_response_id` continues the same conversation |

## 4. Tool Usage Differences

**Before (Chat Completions):**
- Parse `tool_calls` from `choices[0].message`
- Append results as `role: "tool"` message
- Resend all messages in new request

**After (Responses API):**
- Parse `function_call` items from `response.output`
- Send results as `input` items of type `function_call_output` with matching `call_id`
- Continue with `previous_response_id`

Example follow-up after tool execution:
```ts
await openai.responses.create({
  model: "gpt-4.1",
  previous_response_id: lastResponse.id,
  input: [
    {
      type: "function_call_output",
      call_id: toolCall.call_id,
      output: JSON.stringify({ result: "done" })
    }
  ]
});
```

It’s necessary to include the original tool call as well as the results as input. Please see step 4: https://platform.openai.com/docs/guides/function-calling?api-mode=responses#function-calling-steps

The actual function call ID sent by an assistant is not enforced, to where you have to absolutely use what the model sent you. You can make up your own.

The issue and primary requirement is that a function_call must be immediately followed by a function_call_output, both with call_id. The purpose of call_id is to pair the return to the calling function and its arguments in the case of parallel tool calls.

Detailed example:
```
{
  "model": "gpt-4o",
  "input": [
    {
      "role": "system",
      "content": [
        {
          "type": "input_text",
          "text": "You are WeatherPal, a virtual assistant acclaimed for your meteorology expertise and your ability to provide accurate weather conditions across the United States.\nCurrent time of latest input: 2025-03-14T17:22:00Z"
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Toledo Ohio looking hot out right now?"
        }
      ]
    },
    {
      "type": "function_call",
      "call_id": "call_qCYF1LIA9qAK0Nvp24dMqNUP",
      "name": "get_current_us_weather",
      "arguments": "{\"us_city\":\"Toledo\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_qCYF1LIA9qAK0Nvp24dMqNUP",
      "output": "Toledo, OH - Current conditions: 62F, partly cloudy"
    }
  ],
  "tools": [
    {
      "type": "function",
      "name": "get_current_us_weather",
      "description": "Retrieves the current weather for a specified US city",
      "parameters": {
        "type": "object",
        "required": [
          "us_city"
        ],
        "properties": {
          "us_city": {
            "type": "string",
            "description": "The name of the US city for which to retrieve the current weather"
          }
        },
        "additionalProperties": false
      },
      "strict": true
    },
    {
      "type": "function",
      "name": "get_usa_city_forecast",
      "description": "Function for 5-day forecast retrieval.",
      "parameters": {
        "type": "object",
        "required": [
          "us_city"
        ],
        "properties": {
          "us_city": {
            "type": "string",
            "description": "Major city name, state abbreviation (e.g. Miami, FL)."
          }
        },
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "text": {
    "format": {
      "type": "text"
    }
  },
  "temperature": 1,
  "top_p": 1,
  "parallel_tool_calls": true,
  "reasoning": {},
  "stream": true,
  "max_output_tokens": 2048,
  "store": true
}
```

## 5. Key Benefits of Responses API
- Built-in conversation state management
- Unified interface for text, tools, and built-in capabilities
- Simplified multi-turn + tool orchestration

---
**Tip:** In multi-turn flows, use `store: true` on the first request, then only send `previous_response_id` and any new `input` items in follow-up calls.
