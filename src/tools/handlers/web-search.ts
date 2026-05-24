import OpenAI, { ClientOptions } from 'openai';
import { ProxyAgent } from 'undici';
import { FunctionHandler } from '../../agentConfigs/types';
import { configService } from '../../config';
import { ensureSession, appendEvent } from '../../observability/thoughtflow';
import { session } from '../../session/state';

function createOpenAIClient(): OpenAI {
  const options: ClientOptions = { apiKey: configService.get('OPENAI_API_KEY') };
  if (configService.get('CODEX_CLI') === 'true' && configService.get('HTTPS_PROXY')) {
    try {
      const dispatcher = new ProxyAgent(configService.get('HTTPS_PROXY')!);
      options.fetch = (url, init: any = {}) => {
        return (globalThis.fetch as any)(url, { ...(init || {}), dispatcher });
      };
    } catch (e) {
      console.warn('[web_search] Failed to configure ProxyAgent, continuing without proxy:', e);
    }
  }
  return new OpenAI(options);
}

export const WEB_SEARCH_MODEL = 'gpt-5-mini';

export const webSearchFunction: FunctionHandler = {
  schema: {
    name: 'web_search',
    type: 'function',
    description:
      'Search the web for factual information. Use this for ANY factual claim — names, dates, definitions, statistics, events, prices, schedules, specifications, locations, biographies, references, current affairs, historical facts — regardless of how well-known or old the fact is. The model\'s own knowledge must NOT be used as a source of facts; reserve the model for reasoning, synthesis, and conversation. If a response would assert something verifiable, call this tool first.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A focused natural-language search query targeting the specific fact(s) you need to verify or retrieve.'
        }
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  handler: async (args: { query: string }, addBreadcrumb?: (title: string, data?: any) => void) => {
    const query = (args?.query || '').trim();
    if (!query) {
      return JSON.stringify({ error: 'web_search requires a non-empty query string.' });
    }

    addBreadcrumb?.('web_search request', { query });

    // ThoughtFlow: mark the web_search sub-call so it appears in the trace
    let stepId: string | undefined;
    let convId: string | undefined;
    try {
      ensureSession();
      const req = session.currentRequest;
      if (req) {
        convId = `conv_${req.id}`;
        stepId = `step_web_search_${Date.now()}`;
        appendEvent({
          type: 'step.started',
          conversation_id: convId,
          step_id: stepId,
          label: 'assistant_call',
          payload: {
            name: 'openai.responses.create',
            model: WEB_SEARCH_MODEL,
            arguments: { tool: 'web_search', query },
          },
          timestamp: Date.now(),
        });
      }
    } catch {}

    try {
      const openai = createOpenAIClient();
      const response = await openai.responses.create({
        model: WEB_SEARCH_MODEL,
        reasoning: { effort: 'low' },
        tools: [{ type: 'web_search' } as any],
        input: query,
        store: true,
      });

      const text = response.output_text || '';
      addBreadcrumb?.('web_search result', { length: text.length });

      if (convId && stepId) {
        try {
          appendEvent({
            type: 'step.completed',
            conversation_id: convId,
            step_id: stepId,
            payload: { text, response_id: response.id },
            timestamp: Date.now(),
          });
        } catch {}
      }

      return text || 'No results were returned for that query.';
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error('[web_search] error:', message);
      addBreadcrumb?.('web_search error', { error: message });
      if (convId && stepId) {
        try {
          appendEvent({
            type: 'step.completed',
            conversation_id: convId,
            step_id: stepId,
            payload: { error: message },
            timestamp: Date.now(),
          });
        } catch {}
      }
      return JSON.stringify({ error: `web_search failed: ${message}` });
    }
  },
};
