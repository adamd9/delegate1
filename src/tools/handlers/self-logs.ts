import { FunctionHandler } from '../../agentConfigs/types';
import { getLogs } from '../../logBuffer';
import { createOpenAIClient } from '../../services/openaiClient';

const NL_MODEL = 'gpt-5-mini';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseFirstJsonObject(text: string): any | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
  }
  return null;
}

type LogIntent = {
  level: 'error' | 'warn' | 'info' | 'debug' | 'log' | null;
  query: string | null;
  limit: number;
};

async function inferFromRequestWithModel(args: {
  request?: string;
  level?: 'error' | 'warn' | 'info' | 'debug' | 'log';
  query?: string;
  limit?: number;
}): Promise<LogIntent> {
  const explicit: LogIntent = {
    level: args.level || null,
    query: args.query || null,
    limit: clamp(Number(args.limit ?? 80) || 80, 1, 200),
  };

  if (!args.request || !args.request.trim()) return explicit;

  try {
    const client = createOpenAIClient();
    const completion = await client.chat.completions.create({
      model: NL_MODEL,
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content:
            'Convert natural language log-inspection requests into JSON only with keys: level, query, limit. ' +
            'Valid levels: error,warn,info,debug,log,null. For "check your errors" use level=error. Keep limit in [1,200].',
        },
        {
          role: 'user',
          content: JSON.stringify({
            request: args.request,
            explicit_args: {
              level: args.level ?? null,
              query: args.query ?? null,
              limit: args.limit ?? null,
            },
          }),
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    const parsed = parseFirstJsonObject(raw) || {};
    const level = ['error', 'warn', 'info', 'debug', 'log'].includes(parsed.level)
      ? parsed.level
      : explicit.level;
    const query = typeof parsed.query === 'string' && parsed.query.trim() ? parsed.query.trim() : explicit.query;
    const limit = clamp(Number(parsed.limit ?? explicit.limit) || explicit.limit, 1, 200);
    return { level, query, limit };
  } catch {
    return explicit;
  }
}

function lineMatchesLevel(line: string, level?: string): boolean {
  if (!level) return true;
  return line.toUpperCase().includes(` ${String(level).toUpperCase()}:`);
}

function lineMatchesQuery(line: string, query?: string): boolean {
  if (!query) return true;
  return line.toLowerCase().includes(query.toLowerCase());
}

function summarize(lines: string[]) {
  const counts = { error: 0, warn: 0, info: 0, debug: 0, log: 0 };
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.includes(' ERROR:')) counts.error += 1;
    else if (upper.includes(' WARN:')) counts.warn += 1;
    else if (upper.includes(' INFO:')) counts.info += 1;
    else if (upper.includes(' DEBUG:')) counts.debug += 1;
    else if (upper.includes(' LOG:')) counts.log += 1;
  }
  return counts;
}

export const readSelfLogsFunction: FunctionHandler = {
  schema: {
    name: 'read_self_logs',
    type: 'function',
    description: 'Read this assistant\'s own in-process server logs (captured via logBuffer). Supports natural requests like "check your errors" and "last 50 logs".',
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'Natural language request, for example: "check your errors", "last 50 logs", or "logs containing timeout".',
        },
        level: {
          type: 'string',
          enum: ['error', 'warn', 'info', 'debug', 'log'],
          description: 'Optional level filter.',
        },
        query: {
          type: 'string',
          description: 'Optional free-text match against log lines.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of log lines to return from the end of the filtered set (default 80, max 200).',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  handler: async (args: {
    request?: string;
    level?: 'error' | 'warn' | 'info' | 'debug' | 'log';
    query?: string;
    limit?: number;
  }) => {
    try {
      const inferred = await inferFromRequestWithModel(args);
      const level = inferred.level || null;
      const query = inferred.query || null;
      const limit = inferred.limit;

      const all = getLogs();
      const filtered = all
        .filter((line) => lineMatchesLevel(line, level || undefined))
        .filter((line) => lineMatchesQuery(line, query || undefined));
      const lines = filtered.slice(-limit);

      return {
        source: 'assistant_self_logs',
        ownership_context: 'These log lines are from this running assistant process (console output captured by logBuffer).',
        applied: {
          request: args.request || null,
          level: level || null,
          query: query || null,
          limit,
        },
        totals: {
          buffered_lines: all.length,
          filtered_lines: filtered.length,
          returned_lines: lines.length,
          level_counts_in_returned: summarize(lines),
        },
        lines,
      };
    } catch (e: any) {
      return { error: e?.message || 'Failed to read self logs' };
    }
  },
};
