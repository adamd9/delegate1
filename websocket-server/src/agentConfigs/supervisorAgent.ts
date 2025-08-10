import { FunctionHandler } from './types';
import { supervisorAgentConfig } from './supervisorAgentConfig';
import { ResponsesFunctionCall, ResponsesFunctionCallOutput, ResponsesInputItem, ResponsesTextInput, ResponsesOutputItem } from '../types';
import OpenAI, { ClientOptions } from 'openai';
import { ProxyAgent } from 'undici';

import { getCurrentTimeFunction } from './supervisorTools';

// Supervisor tool response handler
export async function getSupervisorToolResponse(functionName: string, args: any): Promise<string> {
  const supervisorTools = [getCurrentTimeFunction];
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
  const options: ClientOptions = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.CODEX_CLI === 'true' && process.env.HTTPS_PROXY) {
    try {
      const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
      options.fetch = (url, init: any = {}) => {
        return (globalThis.fetch as any)(url, { ...(init || {}), dispatcher });
      };
      console.debug('OpenAI Client', 'Using undici ProxyAgent for Codex environment');
    } catch (e) {
      console.warn('OpenAI Client', 'Failed to configure ProxyAgent, continuing without proxy:', e);
    }
  }
  const openai = new OpenAI(options);
  
  // Initial request
  let requestBody: any = {
    model: "gpt-5-mini",
    reasoning: {
      effort: 'low' as const,
    },
    instructions,
    input,
    tools,
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
      model: "gpt-5-mini",
      reasoning: {
        effort: 'low' as const,
      },
      previous_response_id: currentResponseId,
      input: functionCallOutputs,
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
      required: ["query", "context", "reasoning_type"],
      additionalProperties: false
    }
  },
  handler: async (args: { query: string; context?: string; reasoning_type: string }, addBreadcrumb?: (title: string, data?: any) => void) => {
    try {

      const supervisorAgentInstructions = supervisorAgentConfig.instructions
      .replace("{{query}}", args.query)
      .replace("{{context}}", args.context || "")
      .replace("{{reasoning_type}}", args.reasoning_type);

      const supervisorPrompt = supervisorAgentInstructions;

      const tools = [
        { type: "web_search" as const },
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
