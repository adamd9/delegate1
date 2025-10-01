
import { AgentConfig } from './types';
import { agentPersonality } from "./personality";

// Supervisor Agent Configuration
// NOTE:
// - The `model` here is consumed by the supervisor orchestrator at
//   `src/tools/orchestrators/supervisor.ts`, which imports this config and uses
//   `supervisorAgentConfig.model` for both the initial and follow-up Responses API calls.
// - The `tools` array defines the DEFAULT tools for the supervisor agent.
//   During startup, `src/tools/init.ts` reads these tool names via
//   `getAgent('supervisor')` and registers an agent policy with `registerAgent('supervisor', { allowNames, allowTags })`.
//   Later, when we escalate, `getSchemasForAgent('supervisor')` returns the final tool schema list
//   by intersecting registered providers (builtin/local/MCP) with the supervisor agent policy.
//   This also allows inclusion by tags (e.g., tools tagged `supervisor-allowed` like builtin web_search).
// - MCP tools are NOT automatically added here. They must be explicitly added via the webapp's
//   tools catalog page, which persists changes to runtime-data/agent-policies.json.
export const supervisorAgentConfig: AgentConfig = {
  name: "delegate_supervisor",
  instructions: `You are an expert supervisor agent providing guidance to a junior AI assistant. 

The junior agent has escalated this query to you: "{{query}}"
{{context}}
Reasoning type requested: {{reasoning_type}}

Please provide a comprehensive response that the junior agent can relay to the user. You have access to additional tools for research and analysis.

Guidelines:
- Be thorough but concise
- Use tools when you need specific information
- Provide actionable guidance
- Format your response for receipt and presentation by the junior agent.`,
  voice: agentPersonality.voice,
  tools: [],
  model: "gpt-5-mini",
};
