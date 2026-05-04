import type { Application, Request, Response } from 'express';
import { WebSocket } from 'ws';
import { handleTextChatMessage } from '../../session/chat';
import { getSessionOutput, markHookDelivered, setFallbackInjector } from '../../tools/handlers/copilotCli';

function formatNotification(task: string, status: string, conversationId?: string): string {
  const statusLine = status === 'complete' ? 'completed successfully'
    : status === 'error' ? 'encountered an error'
    : status === 'timeout' ? 'timed out'
    : `finished (${status})`;

  const convRef = conversationId ? `\nConversation ID: ${conversationId}` : '';

  return (
    `[COPILOT TASK NOTIFICATION — this is NOT from the user]\n\n` +
    `A background task you dispatched has ${statusLine}.\n` +
    `Task: "${task}"${convRef}\n\n` +
    `IMPORTANT: Before responding, check if there are any notes for this conversation ID that contain task context or user preferences for how to handle the result.\n\n` +
    `You can use the \`list_notes\` tool to search for notes with the conversation ID or task summary, and the \`get_note\` tool to read them.\n\n` +
    `Once you\'ve checked the task context (if any), you can use the \`copilot_status\` tool to retrieve the full output if needed.\n` +
    `If the note has a preference (email, Slack, etc.), honor it. If no preference is recorded, default to SMS. Decide whether to fetch and share results with the user, or simply let them know the task is done.`
  );
}

export function registerCopilotRoutes(
  app: Application,
  options: { chatClients: Set<WebSocket>; logsClients: Set<WebSocket> }
) {
  const { chatClients, logsClients } = options;

  // Wire the fallback injector so the close handler can inject a notification if hooks don't fire
  setFallbackInjector((task, status, _stdout, _stderr) => {
    const message = formatNotification(task, status);
    console.log(`[copilot-callback] Fallback notification (status=${status})`);
    handleTextChatMessage(message, chatClients, logsClients, 'copilot').catch((err) => {
      console.error('[copilot-callback] Fallback notification failed:', err);
    });
  });

  app.post('/api/copilot/callback', async (req: Request, res: Response) => {
    try {
      const { hookType, payload } = req.body || {};

      if (!hookType || !payload) {
        res.status(400).json({ error: 'Missing hookType or payload' });
        return;
      }

      console.log(`[copilot-callback] Received ${hookType} hook`);

      switch (hookType) {
        case 'sessionEnd': {
          const sessionOutput = getSessionOutput();
          const reason = payload.reason || 'unknown';
          const task = sessionOutput?.task || 'unknown task';

          // Signal that hooks delivered — prevents fallback notification on close
          markHookDelivered();

          // Try to get conversation ID from current session
          let conversationId: string | undefined;
          try {
            const sess = require('../../session/state').session;
            conversationId = (sess as any).currentConversationId as string | undefined;
          } catch {}

          const message = formatNotification(task, reason, conversationId);
          await handleTextChatMessage(message, chatClients, logsClients, 'copilot');

          console.log(`[copilot-callback] sessionEnd notification sent (reason=${reason})`);
          res.json({ ok: true, action: 'notified' });
          break;
        }

        case 'errorOccurred': {
          const errorMsg = payload.error?.message || 'Unknown error';
          const errorName = payload.error?.name || 'Error';
          const sessionOutput = getSessionOutput();
          const task = sessionOutput?.task || 'unknown task';

          // Try to get conversation ID from current session
          let conversationId: string | undefined;
          try {
            const sess = require('../../session/state').session;
            conversationId = (sess as any).currentConversationId as string | undefined;
          } catch {}

          const convRef = conversationId ? `\nConversation ID: ${conversationId}` : '';
          const message =
            `[COPILOT TASK NOTIFICATION — this is NOT from the user]\n\n` +
            `A background task encountered an error: ${errorName}: ${errorMsg}\n` +
            `Task: "${task}"${convRef}\n\n` +
            `IMPORTANT: Before responding, check if there are any notes for this conversation ID that contain task context or user preferences.\n\n` +
            `You can use the \`list_notes\` tool to search by conversation ID, and \`get_note\` to read task details.\n\n` +
            `Once checked, use \`copilot_status\` to see the full output. If the note has a preference, honor it; default to SMS if no preference recorded. Decide whether to inform the user or retry.`;

          await handleTextChatMessage(message, chatClients, logsClients, 'copilot');

          console.log(`[copilot-callback] errorOccurred notification (${errorName}: ${errorMsg})`);
          res.json({ ok: true, action: 'notified' });
          break;
        }

        case 'postToolUse': {
          const toolName = payload.toolName || 'unknown';
          const resultType = payload.toolResult?.resultType || 'unknown';
          console.log(`[copilot-callback] postToolUse: ${toolName} → ${resultType}`);
          res.json({ ok: true, action: 'logged' });
          break;
        }

        default:
          console.log(`[copilot-callback] Unknown hookType: ${hookType}`);
          res.json({ ok: true, action: 'ignored' });
      }
    } catch (err: any) {
      console.error('[copilot-callback] Error processing callback:', err);
      res.status(500).json({ error: err.message || 'Internal error' });
    }
  });
}
