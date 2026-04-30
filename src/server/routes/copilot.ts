import type { Application, Request, Response } from 'express';
import { WebSocket } from 'ws';
import { handleTextChatMessage } from '../../session/chat';
import { getSessionOutput, markHookDelivered, setFallbackInjector } from '../../tools/handlers/copilotCli';

function formatNotification(task: string, status: string): string {
  const statusLine = status === 'complete' ? 'completed successfully'
    : status === 'error' ? 'encountered an error'
    : status === 'timeout' ? 'timed out'
    : `finished (${status})`;

  return (
    `[COPILOT TASK NOTIFICATION — this is NOT from the user]\n\n` +
    `A background task you dispatched has ${statusLine}.\n` +
    `Task: "${task}"\n\n` +
    `Use the \`copilot_status\` tool to retrieve the full output, then complete any follow-up actions the user originally requested (for example: send an email, create a note, send an SMS, or summarize results to the user). Do not just acknowledge completion — deliver the originally requested output or action.`
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

          const message = formatNotification(task, reason);
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

          const message =
            `[COPILOT TASK NOTIFICATION — this is NOT from the user]\n\n` +
            `A background task encountered an error: ${errorName}: ${errorMsg}\n` +
            `Task: "${task}"\n\n` +
            `You can use \`copilot_status\` to see any partial output. ` +
            `Inform the user about the error and, if appropriate, retry or complete any originally requested follow-up actions with whatever results are available.`;

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
