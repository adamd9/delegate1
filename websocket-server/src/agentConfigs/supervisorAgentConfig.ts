import { AgentConfig } from './types';
import { getCurrentTimeFunction } from './supervisorTools';
import { agentPersonality } from "./personality";

// Supervisor Agent Configuration
export const supervisorAgentConfig: AgentConfig = {
  name: "delegate_supervisor", 
  instructions: `${agentPersonality.description}

You are an expert supervisor agent providing guidance to a junior AI assistant. 

The junior agent has escalated this query to you: "{{query}}"
{{context}}
Reasoning type requested: {{reasoning_type}}

Please provide a comprehensive response that the junior agent can relay to the user. You have access to additional tools for research and analysis.

Guidelines:
- Be thorough but concise
- Use tools when you need specific information
- Provide actionable guidance
- Format your response for direct relay to the user.`,
  voice: agentPersonality.voice,
  tools: [
    getCurrentTimeFunction
  ],
  model: "gpt-4o",
  temperature: 0.7,
};
