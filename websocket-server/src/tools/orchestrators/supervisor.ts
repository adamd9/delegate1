import OpenAI, { ClientOptions } from 'openai';
import { ProxyAgent } from 'undici';
import { ResponsesFunctionCall, ResponsesFunctionCallOutput, ResponsesInputItem } from '../../types';
import { executeBySanitizedName } from '../registry';
import { getAdaptationTextById } from '../../adaptations';
import { ensureSession, appendEvent, ThoughtFlowStepType } from '../../observability/thoughtflow';
import { session } from '../../session/state';

import { supervisorAgentConfig } from '../../agentConfigs/supervisorAgentConfig';

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

  // Inject supervisor initial adaptation
  const supInitAdapt = await getAdaptationTextById('adn.prompt.supervisor.initial');
  const supInitText = (supInitAdapt?.text || '').trim();
  let supInitAdaptStepId: string | undefined;
  if (supInitText) {
    // Instrument prompt.adaptations step when possible
    try {
      ensureSession();
      const req = session.currentRequest;
      if (req) {
        const convId = `conv_${req.id}`;
        supInitAdaptStepId = `snp_sup_init_${Date.now()}`;
        appendEvent({
          type: 'step.started',
          conversation_id: convId,
          step_id: supInitAdaptStepId,
          label: 'prompt.adaptations',
          payload: {
            adaptation_id: 'adn.prompt.supervisor.initial',
            content_preview: supInitText.slice(0, 200),
            content_length: supInitText.length,
            scope: { agent: 'supervisor', channel: req.channel },
            modifiable: true,
            version: supInitAdapt?.version || 0,
          },
          timestamp: Date.now(),
        });
        appendEvent({ type: 'step.completed', conversation_id: convId, step_id: supInitAdaptStepId, timestamp: Date.now() });
      }
    } catch {}
  }

  let requestBody: any = {
    model: supervisorAgentConfig.model,
    reasoning,
    instructions: [supInitText, instructions].filter(Boolean).join('\n'),
    input,
    tools,
    store: true
  };
  
  // If continuing a conversation, include previous_response_id
  if (currentResponseId) {
    requestBody.previous_response_id = currentResponseId;
  }
  
  // ThoughtFlow: emit supervisor assistant_call (initial)
  let supInitLlmStepId: string | undefined;
  try {
    ensureSession();
    const req = session.currentRequest;
    if (req) {
      const convId = `conv_${req.id}`;
      supInitLlmStepId = `step_sup_llm_init_${Date.now()}`;
      const toolNames = Array.isArray(tools) ? tools.map((t: any) => t?.name).filter(Boolean) : [];
      const provenance = {
        parts: [
          ...(supInitText ? [{ type: 'prompt_adaptations', value: supInitText }] as any[] : []),
          { type: 'supervisor_instruction', value: instructions },
          { type: 'tool_schemas_snapshot', value: `tools:${Array.isArray(tools) ? tools.length : 0}` },
        ],
        final_prompt: [supInitText, instructions].filter(Boolean).join('\n'),
      } as any;
      appendEvent({
        type: 'step.started',
        conversation_id: convId,
        step_id: supInitLlmStepId,
        label: 'assistant_call',
        ...(supInitAdaptStepId ? { depends_on: [supInitAdaptStepId] } : {}),
        payload: {
          name: 'openai.responses.create',
          model: supervisorAgentConfig.model,
          arguments: {
            instructions_preview: provenance.final_prompt.slice(0, 200),
            tools_count: Array.isArray(tools) ? tools.length : 0,
          },
          prompt_provenance: provenance,
        },
        timestamp: Date.now(),
      });
    }
  } catch {}

  console.log("[DEBUG] Initial Responses API request:", JSON.stringify(requestBody, null, 2));
  let currentResponse = await openai.responses.create(requestBody);
  try {
    ensureSession();
    const req = session.currentRequest;
    if (req && supInitLlmStepId) {
      const convId = `conv_${req.id}`;
      const functionCalls = currentResponse.output?.filter((o: any) => o.type === 'function_call') || [];
      appendEvent({
        type: 'step.completed',
        conversation_id: convId,
        step_id: supInitLlmStepId,
        payload: {
          text: currentResponse.output_text,
          function_calls: functionCalls.map((fc: any) => ({ name: fc.name, args: fc.arguments, call_id: fc.call_id })),
          response_id: currentResponse.id,
        },
        timestamp: Date.now(),
      });
    }
  } catch {}
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
    // Inject supervisor follow-up adaptation
    const supFollowAdapt = await getAdaptationTextById('adn.prompt.supervisor.followup');
    const supFollowText = (supFollowAdapt?.text || '').trim();
    let supFollowAdaptStepId: string | undefined;
    if (supFollowText) {
      try {
        ensureSession();
        const req = session.currentRequest;
        if (req) {
          const convId = `conv_${req.id}`;
          supFollowAdaptStepId = `snp_sup_follow_${Date.now()}`;
          appendEvent({
            type: 'step.started',
            conversation_id: convId,
            step_id: supFollowAdaptStepId,
            label: 'prompt.adaptations',
            payload: {
              adaptation_id: 'adn.prompt.supervisor.followup',
              content_preview: supFollowText.slice(0, 200),
              content_length: supFollowText.length,
              scope: { agent: 'supervisor', channel: req.channel },
              modifiable: true,
              version: supFollowAdapt?.version || 0,
            },
            timestamp: Date.now(),
          });
          appendEvent({ type: 'step.completed', conversation_id: convId, step_id: supFollowAdaptStepId, timestamp: Date.now() });
        }
      } catch {}
    }

    const followUpRequestBody = {
      model: supervisorAgentConfig.model,
      reasoning,
      previous_response_id: currentResponseId,
      input: functionCallOutputs,
      tools,
      ...(supFollowText ? { instructions: supFollowText } : {}),
    };
    
    addBreadcrumb?.("Supervisor Follow-up", { with_tools: true, outputs: functionCallOutputs.map(o => ({ call_id: o.call_id })) });
    console.log("[DEBUG] Follow-up Responses API request:", JSON.stringify(followUpRequestBody, null, 2));
    // ThoughtFlow: emit supervisor assistant_call (follow-up)
    let supFollowLlmStepId: string | undefined;
    try {
      ensureSession();
      const req = session.currentRequest;
      if (req) {
        const convId = `conv_${req.id}`;
        supFollowLlmStepId = `step_sup_llm_follow_${Date.now()}`;
        const provenance = {
          parts: [
            ...(supFollowText ? [{ type: 'prompt_adaptations', value: supFollowText }] as any[] : []),
            { type: 'previous_response_id', value: String(currentResponseId) },
            { type: 'tool_schemas_snapshot', value: `tools:${Array.isArray(tools) ? tools.length : 0}` },
          ],
          ...(supFollowText ? { final_prompt: supFollowText } : {}),
        } as any;
        appendEvent({
          type: 'step.started',
          conversation_id: convId,
          step_id: supFollowLlmStepId,
          label: 'assistant_call',
          depends_on: [
            ...(supInitLlmStepId ? [supInitLlmStepId] : []),
            ...(supFollowAdaptStepId ? [supFollowAdaptStepId] : []),
          ],
          payload: {
            name: 'openai.responses.create',
            model: supervisorAgentConfig.model,
            arguments: {
              ...(supFollowText ? { instructions_preview: String(supFollowText).slice(0, 200) } : {}),
              tools_count: Array.isArray(tools) ? tools.length : 0,
            },
            prompt_provenance: provenance,
          },
          timestamp: Date.now(),
        });
      }
    } catch {}

    const followUpResponse = await openai.responses.create(followUpRequestBody);
    try {
      ensureSession();
      const req = session.currentRequest;
      if (req && supFollowLlmStepId) {
        const convId = `conv_${req.id}`;
        const functionCallsFU = followUpResponse.output?.filter((o: any) => o.type === 'function_call') || [];
        appendEvent({
          type: 'step.completed',
          conversation_id: convId,
          step_id: supFollowLlmStepId,
          payload: {
            text: followUpResponse.output_text,
            function_calls: functionCallsFU.map((fc: any) => ({ name: fc.name, args: fc.arguments, call_id: fc.call_id })),
            response_id: followUpResponse.id,
          },
          timestamp: Date.now(),
        });
      }
    } catch {}
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
