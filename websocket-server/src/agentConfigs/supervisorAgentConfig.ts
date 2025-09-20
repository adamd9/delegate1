
import { AgentConfig, FunctionHandler } from './types';
import { agentPersonality } from "./personality";

// Supervisor Agent Configuration
// NOTE:
// - The `model` here is consumed by the supervisor orchestrator at
//   `src/tools/orchestrators/supervisor.ts`, which imports this config and uses
//   `supervisorAgentConfig.model` for both the initial and follow-up Responses API calls.
// - The `tools` array does NOT get passed directly to the OpenAI Responses API.
//   Instead, during startup, `src/tools/init.ts` reads these tool names via
//   `getAgent('supervisor')` and registers an agent policy with `registerAgent('supervisor', { allowNames, allowTags })`.
//   Later, when we escalate, `getSchemasForAgent('supervisor')` returns the final tool schema list
//   by intersecting registered providers (builtin/local/MCP) with the supervisor agent policy.
//   This also allows inclusion by tags (e.g., tools tagged `supervisor-allowed` like builtin web_search).
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

export function updateSupervisorMcpTools(handlers: FunctionHandler[]) {
  supervisorAgentConfig.tools = handlers;
}
