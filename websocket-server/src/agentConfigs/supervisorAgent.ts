import { AgentConfig, FunctionHandler } from './types';
import OpenAI from 'openai';

// Knowledge base lookup function for supervisor
const lookupKnowledgeBaseFunction: FunctionHandler = {
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
const getCurrentTimeFunction: FunctionHandler = {
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

// Supervisor tool response handler
export async function getSupervisorToolResponse(functionName: string, args: any): Promise<string> {
  const supervisorTools = [lookupKnowledgeBaseFunction, getCurrentTimeFunction];
  const tool = supervisorTools.find(t => t.schema.name === functionName);
  
  if (!tool) {
    return JSON.stringify({ error: `Unknown function: ${functionName}` });
  }
  
  try {
    return await tool.handler(args);
  } catch (error) {
    console.error(`Error executing supervisor tool ${functionName}:`, error);
    return JSON.stringify({ error: `Failed to execute ${functionName}` });
  }
}

// Handle iterative function calls like reference implementation
export async function handleSupervisorToolCalls(
  body: any,
  response: any,
  addBreadcrumb?: (title: string, data?: any) => void
): Promise<string> {
  let currentResponse = response;
  let iterations = 0;
  const maxIterations = 5;

  while (currentResponse.choices?.[0]?.message?.tool_calls && iterations < maxIterations) {
    iterations++;
    addBreadcrumb?.(`Supervisor Tool Call Iteration ${iterations}`, {
      tool_calls: currentResponse.choices[0].message.tool_calls
    });

    const toolCalls = currentResponse.choices[0].message.tool_calls;
    const toolResults = [];

    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      const result = await getSupervisorToolResponse(functionName, args);
      
      toolResults.push({
        tool_call_id: toolCall.id,
        role: "tool" as const,
        content: result
      });
    }

    // Add assistant message and tool results to conversation
    body.messages.push(currentResponse.choices[0].message);
    body.messages.push(...toolResults);

    // Make another API call with updated conversation
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    currentResponse = await openai.chat.completions.create(body);
  }

  return currentResponse.choices?.[0]?.message?.content || "No response from supervisor";
}

// Main supervisor function that escalates to heavy model
export const getNextResponseFromSupervisorFunction: FunctionHandler = {
  schema: {
    name: "getNextResponseFromSupervisor",
    type: "function",
    description: "Escalate complex queries to a supervisor agent with access to additional tools and reasoning capabilities. Use this for detailed research, analysis, or when you need additional context.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The user's query or request that needs supervisor attention"
        },
        context: {
          type: "string", 
          description: "Additional context about the conversation or user's needs"
        },
        reasoning_type: {
          type: "string",
          description: "Type of reasoning needed: 'research', 'analysis', 'problem_solving', or 'general'"
        }
      },
      required: ["query", "reasoning_type"],
      additionalProperties: false
    }
  },
  handler: async (args: { query: string; context?: string; reasoning_type: string }, addBreadcrumb?: (title: string, data?: any) => void) => {
    try {
      addBreadcrumb?.("Supervisor Escalation", { 
        query: args.query, 
        reasoning_type: args.reasoning_type 
      });

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const supervisorPrompt = `You are an expert supervisor agent providing guidance to a junior AI assistant. 

The junior agent has escalated this query to you: "${args.query}"
${args.context ? `Additional context: ${args.context}` : ''}
Reasoning type requested: ${args.reasoning_type}

Please provide a comprehensive response that the junior agent can relay to the user. You have access to additional tools for research and analysis.

Guidelines:
- Be thorough but concise
- Use tools when you need specific information
- Provide actionable guidance
- Format your response for direct relay to the user`;

      const body = {
        model: "gpt-4o",
        messages: [
          { role: "system" as const, content: supervisorPrompt }
        ],
        tools: [
          { type: "function" as const, function: lookupKnowledgeBaseFunction.schema },
          { type: "function" as const, function: getCurrentTimeFunction.schema }
        ],
        temperature: 0.7,
        max_tokens: 1000
      };

      const response = await openai.chat.completions.create(body);
      
      // Handle any tool calls iteratively
      const finalResponse = await handleSupervisorToolCalls(body, response, addBreadcrumb);
      
      addBreadcrumb?.("Supervisor Response", { response: finalResponse });
      
      return finalResponse;
      
    } catch (error) {
      console.error('Supervisor escalation error:', error);
      addBreadcrumb?.("Supervisor Error", { error: (error as Error).message });
      return "I apologize, but I'm having trouble accessing the supervisor system right now. Let me try to help you directly with your request.";
    }
  }
};

// Supervisor Agent Configuration
export const supervisorAgent: AgentConfig = {
  name: "delegate_supervisor", 
  instructions: `You are a supervisor agent that provides expert guidance and has access to additional research tools.

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
  voice: "alloy",
  tools: [
    lookupKnowledgeBaseFunction,
    getCurrentTimeFunction,
    getNextResponseFromSupervisorFunction
  ],
  model: "gpt-4o",
  temperature: 0.7,
};
