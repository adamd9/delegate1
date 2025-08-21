import { FunctionHandler } from './types';
import { supervisorAgentConfig } from './supervisorAgentConfig';
import { ResponsesFunctionCall, ResponsesFunctionCallOutput, ResponsesInputItem, ResponsesTextInput, ResponsesOutputItem } from '../types';
import OpenAI, { ClientOptions } from 'openai';
import { ProxyAgent } from 'undici';

import { getCurrentTimeFunction } from './supervisorTools';
import { getDiscoveredMcpHandlers, getDiscoveredMcpFunctionSchemas } from './mcpAdapter';

// Helper to satisfy Responses API tool name pattern: ^[a-zA-Z0-9_-]+$
const sanitizeToolName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '-');

// Helper to avoid flooding breadcrumbs; returns either parsed JSON, truncated string, or object with length
function safeTruncateJson(input: any, maxLen = 1200): any {
  try {
    const str = typeof input === 'string' ? input : JSON.stringify(input);
    if (str.length <= maxLen) {
      try { return JSON.parse(str); } catch { return str; }
    }
    const truncated = str.slice(0, maxLen) + `... [truncated ${str.length - maxLen} chars]`;
    try { return JSON.parse(truncated); } catch { return truncated; }
  } catch {
    return input;
  }
}

// Supervisor tool response handler
export async function getSupervisorToolResponse(functionName: string, args: any): Promise<string> {
  const supervisorTools = [getCurrentTimeFunction, ...getDiscoveredMcpHandlers()];
  // Find by exact name or by sanitized name match
  const tool = supervisorTools.find(t => t.schema.name === functionName || sanitizeToolName(t.schema.name) === functionName);
  
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
      let parsedArgs: any = {};
      try {
        parsedArgs = typeof functionCall.arguments === 'string' ? JSON.parse(functionCall.arguments) : functionCall.arguments;
      } catch {
        parsedArgs = functionCall.arguments;
      }
      // Breadcrumb: function call start
      addBreadcrumb?.(`function call: ${functionName}`, parsedArgs);

      let result: string = '';
      try {
        result = await getSupervisorToolResponse(functionName, parsedArgs);
        // Breadcrumb: function call result
        addBreadcrumb?.(`function call result: ${functionName}`, safeTruncateJson(result));
      } catch (e: any) {
        // Breadcrumb: function error
        addBreadcrumb?.(`function error: ${functionName}`, { error: e?.message || String(e) });
        // Propagate error back as output so model can react
        result = JSON.stringify({ error: e?.message || String(e) });
      }
      
      // Add function call output
      functionCallOutputs.push({
        type: "function_call_output" as const,
        call_id: functionCall.call_id,
        output: result
      });
    }
    
    // Make another API call with function call outputs (include tools so model can continue calling functions)
    const followUpRequestBody = {
      model: "gpt-5-mini",
      reasoning: {
        effort: 'low' as const,
      },
      previous_response_id: currentResponseId,
      input: functionCallOutputs,
      tools,
    };
    
    addBreadcrumb?.("Supervisor Follow-up", { with_tools: true, outputs: functionCallOutputs.map(o => ({ call_id: o.call_id })) });
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
        // Built-in supervisor tool
        {
          type: "function" as const,
          name: getCurrentTimeFunction.schema.name,
          description: getCurrentTimeFunction.schema.description || "",
          parameters: getCurrentTimeFunction.schema.parameters,
          strict: false as const
        },
        // Discovered MCP tools (schemas only)
        ...getDiscoveredMcpFunctionSchemas().map((s) => ({
          ...s,
          name: sanitizeToolName(s.name),
          strict: false as const
        }))
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
