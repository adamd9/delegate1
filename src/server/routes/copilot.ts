import type { Application, Request, Response } from 'express';
import { getLastCompletedSession, getSessionOutput, markHookDelivered, setFallbackInjector, buildTaskUrl } from '../../tools/handlers/copilotCli';
import { listTasks } from '../../copilot/tasks';
import type { GitSyncResult } from '../../browser';
import { injectMessage } from '../../services/agentBridge';

/**
 * Resolve the most-recent task. Because the copilot runner holds a single-task
 * lock, the latest row is the one that just finished — giving us its deep link
 * and the delivery preference recorded at dispatch time.
 */
function resolveLatestTask(): { taskId?: string; taskUrl?: string; notifyPref?: string | null } {
  try {
    const recent = listTasks({ limit: 1 });
    if (!recent.length) return {};
    const t = recent[0];
    let notifyPref: string | null = null;
    try { const m = t.meta_json ? JSON.parse(t.meta_json) : {}; notifyPref = m?.notify ?? null; } catch { /* ignore */ }
    return { taskId: t.id, taskUrl: buildTaskUrl(t.id), notifyPref };
  } catch {
    return {};
  }
}

function formatNotification(opts: {
  task: string;
  status: string;
  conversationId?: string;
  gitResult?: GitSyncResult;
  taskUrl?: string;
  notifyPref?: string | null;
}): string {
  const { task, status, conversationId, gitResult, taskUrl, notifyPref } = opts;
  const statusLine = status === 'complete' ? 'completed successfully'
    : status === 'error' ? 'encountered an error'
    : status === 'timeout' ? 'timed out'
    : `finished (${status})`;

  const convRef = conversationId ? `\nConversation ID: ${conversationId}` : '';
  const linkLine = taskUrl ? `\nTask link: ${taskUrl}` : '';

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

  const pref = notifyPref && notifyPref.trim() ? notifyPref.trim() : 'none recorded — default to SMS';

  return (
    `[COPILOT TASK NOTIFICATION — this is NOT from the user]\n\n` +
    `A background task you dispatched has ${statusLine}.\n` +
    `Task: "${task}"${convRef}${linkLine}${gitLine}\n\n` +
    `Delivery preference: ${pref}.\n\n` +
    `Use the \`copilot_status\` tool to retrieve the full output. Then deliver the result to the user via the recorded preference (default SMS if none), and INCLUDE the task link so they can open live progress and read any output files. Complete any originally requested follow-up action — don't just acknowledge completion.`
  );
}

export function registerCopilotRoutes(app: Application) {
  // Wire the fallback injector so the close handler can inject a notification if hooks don't fire
  setFallbackInjector((task, status, _stdout, _stderr, gitResult) => {
    const { taskUrl, notifyPref } = resolveLatestTask();
    const message = formatNotification({ task, status, gitResult, taskUrl, notifyPref });
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
          const { taskUrl, notifyPref } = resolveLatestTask();
          const message = formatNotification({ task, status: reason, conversationId, gitResult, taskUrl, notifyPref });
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

          const { taskUrl, notifyPref } = resolveLatestTask();
          const convRef = conversationId ? `\nConversation ID: ${conversationId}` : '';
          const linkLine = taskUrl ? `\nTask link: ${taskUrl}` : '';
          const pref = notifyPref && notifyPref.trim() ? notifyPref.trim() : 'none recorded — default to SMS';
          const message =
            `[COPILOT TASK NOTIFICATION — this is NOT from the user]\n\n` +
            `A background task encountered an error: ${errorName}: ${errorMsg}\n` +
            `Task: "${task}"${convRef}${linkLine}\n\n` +
            `Delivery preference: ${pref}.\n\n` +
            `Use \`copilot_status\` to see any available output. Inform the user about the error via the recorded preference (default SMS), include the task link, and if appropriate retry or complete any originally requested follow-up actions with whatever results are available.`;

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
