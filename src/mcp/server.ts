import { randomUUID } from 'node:crypto';
import type { Application, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import {
  deliverAgentMessage,
  formatAgentMessage,
  type AgentMessagePayload,
} from '../server/routes/agentMessage';

type McpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const mcpSessions = new Map<string, McpSession>();

function createMcpServer() {
  const server = new McpServer(
    {
      name: 'delegate1-agent-bridge',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: 'Use the message_agent tool to deliver information into the Delegate assistant conversation.',
    }
  );

  server.registerTool(
    'message_agent',
    {
      description:
        'Send a message to the Delegate assistant. Use this to deliver task results, dispatch new tasks, provide context updates, or communicate any information the assistant should process. The assistant will receive your message and may act on it, respond to the user, or trigger follow-up actions.',
      inputSchema: {
        message: z.string().describe('The content of your message. Can include task results, instructions, context, status updates, or any information for the assistant to process.'),
        sender: z.string().describe("Identifies who is sending the message (e.g., 'copilot-cli', 'calendar-agent', 'build-system'). This helps the assistant understand the source and context."),
        source: z.string().optional().describe("The system or context from which this message originates (e.g., 'github-actions', 'background-task', 'cron-job'). Provides additional context about where the message came from."),
        priority: z.enum(['normal', 'high', 'low']).optional().describe('Message priority. High priority messages may be processed more urgently.'),
        metadata: z.record(z.string(), z.unknown()).optional().describe("Additional structured data to include with the message (e.g., { conversationId: '...', taskId: '...' })."),
      },
    },
    async (args) => {
      const payload: AgentMessagePayload = {
        message: args.message,
        sender: args.sender,
        ...(args.source ? { source: args.source } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
        ...(args.metadata ? { metadata: args.metadata } : {}),
      };

      const result = await deliverAgentMessage(payload);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                message: formatAgentMessage(payload),
                result,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

function getSessionId(req: Request): string | undefined {
  const header = req.headers['mcp-session-id'];
  return typeof header === 'string' ? header : Array.isArray(header) ? header[0] : undefined;
}

function getMcpDiscoveryResponse() {
  return {
    name: 'delegate1-agent-bridge',
    version: '1.0.0',
    endpoint: '/mcp',
    transport: 'streamable-http',
    tools: [
      {
        name: 'message_agent',
        description:
          'Send a message to the Delegate assistant. Use this to deliver task results, dispatch new tasks, provide context updates, or communicate any information the assistant should process.',
      },
    ],
  };
}

export function registerMcpServerRoutes(app: Application) {
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);

    try {
      if (sessionId && mcpSessions.has(sessionId)) {
        await mcpSessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const server = createMcpServer();
        let transport: StreamableHTTPServerTransport;

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            mcpSessions.set(initializedSessionId, { server, transport });
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport.sessionId;
          if (closedSessionId) {
            mcpSessions.delete(closedSessionId);
          }
          void server.close().catch((err) => console.error('[mcp] Failed to close server:', err));
        };

        transport.onerror = (error) => {
          console.error('[mcp] Transport error:', error);
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid MCP session ID provided',
        },
        id: null,
      });
    } catch (err: any) {
      console.error('[mcp] Failed to handle POST request:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: err?.message || 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      res.json(getMcpDiscoveryResponse());
      return;
    }

    const session = mcpSessions.get(sessionId);
    if (!session) {
      res.status(400).json({ error: 'Invalid or missing MCP session ID' });
      return;
    }

    try {
      await session.transport.handleRequest(req, res);
    } catch (err: any) {
      console.error('[mcp] Failed to handle GET request:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Failed to handle MCP GET request' });
      }
    }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      res.status(400).json({ error: 'MCP session ID is required' });
      return;
    }

    const session = mcpSessions.get(sessionId);
    if (!session) {
      res.status(400).json({ error: 'Invalid MCP session ID' });
      return;
    }

    try {
      await session.transport.handleRequest(req, res);
    } catch (err: any) {
      console.error('[mcp] Failed to handle DELETE request:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Failed to terminate MCP session' });
      }
    }
  });
}
