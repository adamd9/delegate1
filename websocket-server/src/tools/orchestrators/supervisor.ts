import OpenAI, { ClientOptions } from 'openai';
import { ProxyAgent } from 'undici';
import { ResponsesFunctionCall, ResponsesFunctionCallOutput, ResponsesInputItem } from '../../types';
import { executeBySanitizedName } from '../registry';

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
  // If the toolset includes the builtin web_search tool, minimal effort is not allowed.
  const hasWebSearch = Array.isArray(tools) && tools.some((t: any) => t && t.type === 'web_search');
  const reasoning: { effort: 'minimal' | 'low' } = { effort: hasWebSearch ? 'low' : 'minimal' };

  let requestBody: any = {
    model: "gpt-5-mini",
    reasoning,
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
        // Route via centralized registry by sanitizedName
        result = await executeBySanitizedName(functionName, parsedArgs);
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
      reasoning,
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
  
  return { text: finalText, responseId: currentResponseId! };
}
