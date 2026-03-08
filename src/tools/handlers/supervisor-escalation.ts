import { FunctionHandler } from '../../agentConfigs/types';
import { supervisorAgentConfig } from '../../agentConfigs/supervisorAgentConfig';
import { ResponsesTextInput } from '../../types';
import { handleSupervisorToolCalls } from '../orchestrators/supervisor';
import { getSchemasForAgent } from '../registry';
import { contextInstructions, getTimeContext, type Channel } from '../../agentConfigs/context';

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
      // Extract channel from escalation context (best-effort parse)
      const channelMatch = (args.context || '').match(/\bchannel:\s*(voice|text|sms|email)\b/i);
      const channel: Channel = (channelMatch ? channelMatch[1].toLowerCase() : 'text') as Channel;
      const { currentTime, timeZone } = getTimeContext();
      const contextPreamble = contextInstructions({ channel, currentTime, timeZone });

      const supervisorAgentInstructions = [contextPreamble, supervisorAgentConfig.instructions]
        .filter(Boolean)
        .join('\n')
        .replace("{{query}}", args.query)
        .replace("{{context}}", args.context || "")
        .replace("{{reasoning_type}}", args.reasoning_type);

      const tools = getSchemasForAgent('supervisor');

      const input: ResponsesTextInput = {
        type: "message",
        content: args.query,
        role: "user"
      };

      // Hidden plumbing: orchestrator passes the originating tool_call ThoughtFlow step id
      const dependsOnStepId = (args as any).__dependsOnStepId as string | undefined;
      if (!dependsOnStepId) {
        throw new Error('getNextResponseFromSupervisor: missing dependsOnStepId from orchestrator');
      }

      const { text: finalResponse, supInitStepId, supLastStepId } = await handleSupervisorToolCalls(
        supervisorAgentInstructions,
        [input],
        tools,
        dependsOnStepId,
        undefined,
        addBreadcrumb,
      );

      // Return structured object so upstream can wire ThoughtFlow dependencies correctly
      return { text: finalResponse, supInitStepId, supLastStepId };
    } catch (error) {
      console.error('Supervisor escalation error:', error);
      addBreadcrumb?.("Supervisor Error", { error: (error as Error).message });
      return "I apologize, but I'm having trouble accessing the supervisor system right now. Let me try to help you directly with your request.";
    }
  }
};
