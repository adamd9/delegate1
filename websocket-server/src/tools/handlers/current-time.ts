import { FunctionHandler } from '../../agentConfigs/types';

// Get current time function for supervisor and any agent
export const getCurrentTimeFunction: FunctionHandler = {
  schema: {
    name: "getCurrentTime",
    type: "function",
    description: "Get the current date and time.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    }
  },
  handler: async () => {
    const now = new Date();
    return JSON.stringify({
      current_time: now.toISOString(),
      formatted_time: now.toLocaleString()
    });
  },
};
