import { FunctionHandler } from './types';

// Knowledge base lookup function for supervisor
export const lookupKnowledgeBaseFunction: FunctionHandler = {
  schema: {
    name: "lookupKnowledgeBase",
    type: "function",
    description: "Look up information from the knowledge base by topic or keyword.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The topic or keyword to search for in the knowledge base."
        }
      },
      required: ["topic"],
      additionalProperties: false
    }
  },
  handler: async (args: { topic: string }) => {
    // Simulate knowledge base lookup
    const knowledgeBase = {
      "company_policy": "Our company follows strict data privacy guidelines and customer service standards.",
      "product_info": "We offer various AI assistant services with different capability tiers.",
      "technical_support": "For technical issues, we provide 24/7 support with escalation procedures."
    };

    const result = knowledgeBase[args.topic as keyof typeof knowledgeBase] ||
                  "No specific information found for this topic.";
    return JSON.stringify({ result, topic: args.topic });
  },
};

// Get current time function for supervisor
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

