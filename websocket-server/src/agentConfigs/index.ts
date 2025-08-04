import { AgentConfig, FunctionHandler } from './types';
import { delegate1Agent, agents, defaultAgent } from './agents';

// Export the main agent and all agents
export { delegate1Agent, agents, defaultAgent };

// Helper functions for accessing agent configurations
export function getAgent(agentName: 'base' | 'supervisor'): AgentConfig {
  return agents[agentName];
}

export function getDefaultAgent(): AgentConfig {
  return defaultAgent;
}

export function getAllFunctions(): FunctionHandler[] {
  // Collect all unique functions from all agents
  const functionMap = new Map<string, FunctionHandler>();
  
  Object.entries(agents).forEach(([agentName, agent]) => {
    if (!agent.tools || !Array.isArray(agent.tools)) {
      console.warn(`[getAllFunctions] Agent ${agentName} has no tools or tools is not an array`, agent.tools);
      return;
    }
    agent.tools.forEach((tool, idx) => {
      if (!tool || !tool.schema) {
        console.warn(`[getAllFunctions] Tool at index ${idx} in agent ${agentName} is invalid:`, tool);
        return;
      }
      console.log(`[getAllFunctions] Tool schema for agent ${agentName}:`, tool.schema);
      functionMap.set(tool.schema.name, tool);
    });
  });
  
  return Array.from(functionMap.values());
}

// Re-export types for convenience
export type { AgentConfig, FunctionHandler } from './types';
