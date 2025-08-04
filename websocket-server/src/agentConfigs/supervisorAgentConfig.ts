import { AgentConfig } from './types';
import { 
  lookupKnowledgeBaseFunction, 
  getCurrentTimeFunction, 
  getNextResponseFromSupervisorFunction 
} from './supervisorAgent';
import { agentPersonality } from "./personality";

// Supervisor Agent Configuration
export const supervisorAgentConfig: AgentConfig = {
  name: "delegate_supervisor", 
  instructions: `${agentPersonality.description}

You are a supervisor agent that provides expert guidance and has access to additional research tools.

You are called upon when the base agent needs help with:
- Complex research queries
- Detailed analysis tasks  
- Problem-solving that requires additional context
- Questions that need knowledge base lookup

You have access to:
- Knowledge base lookup capabilities
- Current time/date information
- Advanced reasoning and analysis capabilities

Always provide comprehensive but concise responses that can be directly relayed to the user.`,
  voice: agentPersonality.voice,
  tools: [
    getCurrentTimeFunction,
    getNextResponseFromSupervisorFunction
  ],
  model: "gpt-4o",
  temperature: 0.7,
};
