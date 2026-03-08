import { baseAgent } from './baseAgent';
import { supervisorAgent, getNextResponseFromSupervisorFunction } from './supervisorAgent';

// Add supervisor function to base agent's tools
export const delegate1Agent = {
  ...baseAgent,
  tools: [
    ...baseAgent.tools,
    getNextResponseFromSupervisorFunction
  ]
};

// Export both agents for the system
export const agents = {
  base: delegate1Agent,
  supervisor: supervisorAgent
};

// Default agent is the base agent
export const defaultAgent = delegate1Agent;
