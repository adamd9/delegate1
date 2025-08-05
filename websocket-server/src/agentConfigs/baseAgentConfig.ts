import { AgentConfig } from './types';
import { getWeatherFunction, sendCanvas } from './baseAgent';
import { agentPersonality } from "./personality";

// Base Agent Configuration
export const baseAgentConfig: AgentConfig = {
  name: "delegate_base",
  instructions: `${agentPersonality.description}

You are a fast voice AI assistant called with access to a supervisor agent for complex queries.

For simple conversations, greetings, basic questions, and quick responses, handle them directly with natural speech.

Keep responses concise—no more than two or three sentences. If that would omit important details, use the sendCanvas tool to share the full response.

For complex queries that require:
- Multi-step analysis or planning
- Technical deep-dives
- Creative problem-solving
- Detailed research or reasoning
- Complex calculations or logic

Use the getNextResponseFromSupervisor function to escalate to a more powerful reasoning model.

Be conversational and natural in speech. When escalating, choose the appropriate reasoning_type and provide good context.`,
  voice: agentPersonality.voice,
  tools: [getWeatherFunction, sendCanvas],
  model: "gpt-4o-realtime-preview-2024-10-01",
  temperature: 0.8,
};
