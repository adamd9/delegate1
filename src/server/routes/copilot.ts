import type { Application, Request, Response } from 'express';
import { markHookDelivered, setFallbackInjector, buildTaskUrl } from '../../tools/handlers/copilotCli';
import { listTasks } from '../../copilot/tasks';
import type { GitSyncResult } from '../../browser';
import { publishInnerSignal } from '../../innerContext';
import { formatCopilotTaskNotification } from '../../copilot/notification';

/**
 * Resolve the most-recent task. Because the copilot runner holds a single-task
 * lock, the latest row is the one that just finished — giving us its deep link
 * and the delivery preference recorded at dispatch time.
 */
function resolveLatestTask(): {
  taskId?: string;
  title?: string;
  taskUrl?: string;
  notifyPref?: string | null;
  conversationId?: string;
  gitResult?: GitSyncResult;
} {
  try {
    const recent = listTasks({ limit: 1 });
    if (!recent.length) return {};
    const t = recent[0];
    let notifyPref: string | null = null;
    let gitResult: GitSyncResult | undefined;
    try {
      const metadata = t.meta_json ? JSON.parse(t.meta_json) : {};
      notifyPref = metadata?.notify ?? null;
      gitResult = metadata?.lastGit;
    } catch { /* ignore */ }
    return {
      taskId: t.id,
      title: t.title,
      taskUrl: buildTaskUrl(t.id),
      notifyPref,
      conversationId: t.originating_conversation_id || undefined,
      gitResult,
    };
  } catch {
    return {};
  }
}

function gitMessage(result?: GitSyncResult): string | undefined {
  if (!result) return undefined;
  if (result.status === 'no_changes') return 'No file changes to commit.';
  return result.message;
}

function publishCopilotSignal(message: string, status: string, taskId?: string, conversationId?: string) {
  return publishInnerSignal({
    ...(taskId ? { id: `copilot:${taskId}:${status}` } : {}),
    kind: status === 'error' ? 'copilot.task-failed' : 'copilot.task-completed',
    source: 'copilot',
    awarenessMode: 'wake',
    priority: status === 'error' ? 50 : 10,
    payload: {
      message,
      status,
      ...(taskId ? { taskId } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
  });
}

export function registerCopilotRoutes(app: Application) {
  // Wire the fallback injector so the close handler can inject a notification if hooks don't fire
  setFallbackInjector((task, status, _stdout, _stderr, gitResult) => {
    const context = resolveLatestTask();
    const message = formatCopilotTaskNotification({
      taskId: context.taskId,
      title: context.title || task,
      status,
      conversationId: context.conversationId,
      taskUrl: context.taskUrl,
      notifyPref: context.notifyPref,
      gitMessage: gitMessage(gitResult || context.gitResult),
    });
    console.log(`[copilot-callback] Fallback notification (status=${status}, git=${gitResult?.status || 'n/a'})`);
    try {
      publishCopilotSignal(message, status, context.taskId, context.conversationId);
    } catch (err) {
      console.error('[copilot-callback] Fallback notification failed:', err);
    }
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
          const reason = payload.reason || 'unknown';

          // Signal that hooks delivered — prevents fallback notification on close
          markHookDelivered();
          const context = resolveLatestTask();
          const message = formatCopilotTaskNotification({
            taskId: context.taskId,
            title: context.title || 'unknown task',
            status: reason,
            conversationId: context.conversationId,
            taskUrl: context.taskUrl,
            notifyPref: context.notifyPref,
            gitMessage: gitMessage(context.gitResult),
          });
          publishCopilotSignal(message, reason, context.taskId, context.conversationId);

          console.log(`[copilot-callback] sessionEnd notification sent (reason=${reason})`);
          res.json({ ok: true, action: 'notified' });
          break;
        }

        case 'errorOccurred': {
          const errorMsg = payload.error?.message || 'Unknown error';
          const errorName = payload.error?.name || 'Error';
          const context = resolveLatestTask();
          const convRef = context.conversationId ? `\nConversation ID: ${context.conversationId}` : '';
          const taskIdLine = context.taskId ? `\nTask ID: ${context.taskId}` : '';
          const linkLine = context.taskUrl ? `\nTask link: ${context.taskUrl}` : '';
          const pref = context.notifyPref?.trim() || 'none recorded - default to SMS';
          const message =
            `[COPILOT TASK NOTIFICATION - this is NOT from the user]\n\n` +
            `A background task encountered an error: ${errorName}: ${errorMsg}\n` +
            `Task: "${context.title || 'unknown task'}"${taskIdLine}${convRef}${linkLine}\n\n` +
            `Delivery preference: ${pref}.\n\n` +
            `${context.taskId ? `Use \`copilot_task_status\` with \`task_id_or_name\` set to \`${context.taskId}\`` : 'Use `copilot_status`'} to see any available output. Inform the user via the recorded preference, include the task link, and retry or complete follow-up actions when appropriate.`;

          publishCopilotSignal(message, 'error', context.taskId, context.conversationId);

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
