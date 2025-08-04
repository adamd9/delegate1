import { AgentConfig, FunctionHandler } from './types';
import { agentPersonality } from "./personality";
import { ResponsesFunctionCall, ResponsesFunctionCallOutput, ResponsesInputItem, ResponsesTextInput, ResponsesOutputItem } from '../types';
import OpenAI from 'openai';

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

// Handle iterative function calls using Responses API
export async function handleSupervisorToolCalls(
  instructions: string,
  input: string | ResponsesInputItem[],
  tools: any[],
  previousResponseId?: string,
  addBreadcrumb?: (title: string, data?: any) => void
): Promise<{ text: string, responseId: string }> {
  let currentResponseId = previousResponseId;
  let iterations = 0;
  const maxIterations = 5;
  let finalText = "";
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  // Initial request
  let requestBody: any = {
    model: "gpt-4o",
    instructions,
    input,
    tools,
    temperature: 0.7,
    max_output_tokens: 1000,
    store: true
  };
  
  // If continuing a conversation, include previous_response_id
  if (currentResponseId) {
    requestBody.previous_response_id = currentResponseId;
  }
  
  console.log("[DEBUG] Initial Responses API request:", JSON.stringify(requestBody, null, 2));
  let currentResponse = await openai.responses.create(requestBody);
  console.log("[DEBUG] Initial Responses API response:", JSON.stringify({
    id: currentResponse.id,
    output_text: currentResponse.output_text,
    output: currentResponse.output,
    usage: currentResponse.usage
  }, null, 2));
  currentResponseId = currentResponse.id;
  
  // Process function calls if present
  while (iterations < maxIterations) {
    iterations++;
    
    // Check for function calls in the output
    const functionCalls = currentResponse.output?.filter(item => 
      item.type === 'function_call'
    ) as ResponsesFunctionCall[] | undefined;
    
    if (!functionCalls || functionCalls.length === 0) {
      // No more function calls, we're done
      finalText = currentResponse.output_text || "No response from supervisor";
      break;
    }
    
    addBreadcrumb?.(`Supervisor Tool Call Iteration ${iterations}`, {
      function_calls: functionCalls
    });
    
    // Process each function call
    const functionCallOutputs: ResponsesFunctionCallOutput[] = [];
    
    for (const functionCall of functionCalls) {
      const functionName = functionCall.name;
      const args = JSON.parse(functionCall.arguments);
      const result = await getSupervisorToolResponse(functionName, args);
      
      // Add function call output
      functionCallOutputs.push({
        type: "function_call_output" as const,
        call_id: functionCall.call_id,
        output: result
      });
    }
    
    // Make another API call with function call outputs
    const followUpRequestBody = {
      model: "gpt-4o",
      previous_response_id: currentResponseId,
      input: functionCallOutputs,
      max_output_tokens: 1000
    };
    
    console.log("[DEBUG] Follow-up Responses API request:", JSON.stringify(followUpRequestBody, null, 2));
    const followUpResponse = await openai.responses.create(followUpRequestBody);
    console.log("[DEBUG] Follow-up Responses API response:", JSON.stringify({
      id: followUpResponse.id,
      output_text: followUpResponse.output_text,
      output: followUpResponse.output,
      usage: followUpResponse.usage
    }, null, 2));
    
    currentResponse = followUpResponse;
    currentResponseId = currentResponse.id;
  }
  
  return { text: finalText, responseId: currentResponseId };
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

      const supervisorPrompt = `${agentPersonality.description}

You are an expert supervisor agent providing guidance to a junior AI assistant. 

The junior agent has escalated this query to you: "${args.query}"
${args.context ? `Additional context: ${args.context}` : ''}
Reasoning type requested: ${args.reasoning_type}

Please provide a comprehensive response that the junior agent can relay to the user. You have access to additional tools for research and analysis.

Guidelines:
- Be thorough but concise
- Use tools when you need specific information
- Provide actionable guidance
- Format your response for direct relay to the user`;

      const tools = [
        { 
          type: "function" as const, 
          name: lookupKnowledgeBaseFunction.schema.name,
          description: lookupKnowledgeBaseFunction.schema.description || "",
          parameters: lookupKnowledgeBaseFunction.schema.parameters
        },
        { 
          type: "function" as const, 
          name: getCurrentTimeFunction.schema.name,
          description: getCurrentTimeFunction.schema.description || "",
          parameters: getCurrentTimeFunction.schema.parameters
        }
      ];

      // Initial user input as message input
      const input: ResponsesTextInput = {
        type: "message",
        content: args.query,
        role: "user"
      };

      // Handle tool calls using Responses API
      const { text: finalResponse } = await handleSupervisorToolCalls(
        supervisorPrompt,
        [input],
        tools,
        undefined,
        addBreadcrumb
      );
      
      addBreadcrumb?.("Supervisor Response", { response: finalResponse });
      
      return finalResponse;
      
    } catch (error) {
      console.error('Supervisor escalation error:', error);
      addBreadcrumb?.("Supervisor Error", { error: (error as Error).message });
      return "I apologize, but I'm having trouble accessing the supervisor system right now. Let me try to help you directly with your request.";
    }
  }
};

// Import the supervisor agent configuration
export { supervisorAgentConfig as supervisorAgent } from './supervisorAgentConfig';
