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
  
  Object.values(agents).forEach(agent => {
    agent.tools.forEach(tool => {
      functionMap.set(tool.schema.name, tool);
    });
  });
  
  return Array.from(functionMap.values());
}

// Re-export types for convenience
export type { AgentConfig, FunctionHandler } from './types';
