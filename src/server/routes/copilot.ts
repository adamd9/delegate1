import type { Application, Request, Response } from 'express';
import { getLastCompletedSession, getSessionOutput, markHookDelivered, setFallbackInjector } from '../../tools/handlers/copilotCli';
import type { GitSyncResult } from '../../browser';
import { injectMessage } from '../../services/agentBridge';

function formatNotification(task: string, status: string, conversationId?: string, gitResult?: GitSyncResult): string {
  const statusLine = status === 'complete' ? 'completed successfully'
    : status === 'error' ? 'encountered an error'
    : status === 'timeout' ? 'timed out'
    : `finished (${status})`;

  const convRef = conversationId ? `\nConversation ID: ${conversationId}` : '';

  let gitLine = '';
  if (gitResult) {
    if (gitResult.status === 'pushed') {
      gitLine = `\nGit: ${gitResult.message}`;
    } else if (gitResult.status === 'no_changes') {
      gitLine = `\nGit: No file changes to commit.`;
    } else {
      gitLine = `\nGit issue: ${gitResult.message}`;
    }
  }

  return (
    `[COPILOT TASK NOTIFICATION — this is NOT from the user]\n\n` +
    `A background task you dispatched has ${statusLine}.\n` +
    `Task: "${task}"${convRef}${gitLine}\n\n` +
    `IMPORTANT: Before responding, check if there are any notes for this conversation ID that contain task context or user preferences for how to handle the result.\n\n` +
    `You can use the \`list_notes\` tool to search for notes with the conversation ID or task summary, and the \`get_note\` tool to read them.\n\n` +
      `Once you\'ve checked the task context (if any), use the \`copilot_status\` tool to retrieve the full output, including any published GitHub URL reported by the agent.\n` +
    `If the note has a preference (email, Slack, etc.), honor it. If no preference is recorded, default to SMS. After retrieving the output, complete any originally requested follow-up action instead of only acknowledging completion.`
  );
}

export function registerCopilotRoutes(app: Application) {
  // Wire the fallback injector so the close handler can inject a notification if hooks don't fire
  setFallbackInjector((task, status, _stdout, _stderr, gitResult) => {
    const message = formatNotification(task, status, undefined, gitResult);
    console.log(`[copilot-callback] Fallback notification (status=${status}, git=${gitResult?.status || 'n/a'})`);
    injectMessage({ message, channel: 'copilot' }).catch((err) => {
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
          const completedSession = getLastCompletedSession();
          const gitResult = completedSession?.task === task ? completedSession.gitResult : undefined;

          // Signal that hooks delivered — prevents fallback notification on close
          markHookDelivered();

          // Try to get conversation ID from current session
          let conversationId: string | undefined;
          try {
            const sess = require('../../session/state').session;
            conversationId = (sess as any).currentConversationId as string | undefined;
          } catch {}

          const message = formatNotification(task, reason, conversationId, gitResult);
          await injectMessage({ message, channel: 'copilot' });

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
            `Once checked, use \`copilot_status\` to see any available output. If the note has a preference, honor it; default to SMS if no preference is recorded. Inform the user about the error and, if appropriate, retry or complete any originally requested follow-up actions with whatever results are available.`;

          await injectMessage({ message, channel: 'copilot' });

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
