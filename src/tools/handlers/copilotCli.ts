/**
 * Copilot CLI tool handlers — thin wrappers over taskRunner.
 *
 * Backwards-compatible exports:
 *   - copilotDispatchHandler    → creates a new task and runs its first turn
 *   - copilotGetResultHandler   → returns status of the most recent task (legacy `copilot_status`)
 *
 * New tools:
 *   - copilotContinueHandler    → enqueues a new prompt on an existing task
 *   - copilotTaskStatusHandler  → read-only status + recent output for an existing task
 *
 * Legacy exports (kept for tests/route imports):
 *   getSessionOutput, getLastCompletedSession, clearLastCompletedSession,
 *   setCopilotBroadcast, setFallbackInjector, markHookDelivered
 */

import { FunctionHandler } from '../../agentConfigs/types';
import { configService } from '../../config';
import { isBrowserStackEnabled } from '../../browser/enabled';
import {
  createTaskWithFirstTurn,
  enqueueInput,
  getActiveTurn,
  setTaskBroadcast,
  cancelActiveTurn,
} from '../../copilot/taskRunner';
import {
  findTaskByName,
  getTask,
  listTasks,
  summarizeTask,
  CopilotTaskRow,
} from '../../copilot/tasks';
import type { GitSyncResult } from '../../browser';
import { getEffectivePublicUrl } from '../../server/config/env';

/** Build the public deep link to a task's detail page (live progress + outputs). */
export function buildTaskUrl(taskId: string): string {
  const base = getEffectivePublicUrl().replace(/\/$/, '');
  return `${base}/tasks/${taskId}`;
}

// ---------------------------------------------------------------------------
// Broadcast bridge: route legacy copilot.* and new copilot.task.* through a
// single setter so the WS layer doesn't care which it's wiring up.
// ---------------------------------------------------------------------------

let legacyBroadcastFn: ((msg: { type: string; [k: string]: any }) => void) | null = null;
export function setCopilotBroadcast(fn: ((msg: { type: string; [k: string]: any }) => void) | null) {
  legacyBroadcastFn = fn;
  setTaskBroadcast(fn);
}

// ---------------------------------------------------------------------------
// Legacy single-session API surface (used by routes/copilot.ts and tests).
// Each call peeks at the latest task to maintain compatibility.
// ---------------------------------------------------------------------------

export function getSessionOutput(): { stdout: string; stderr: string; task: string } | null {
  const active = getActiveTurn();
  if (!active) return null;
  const t = getTask(active.taskId);
  if (!t) return null;
  return { stdout: t.last_summary || '', stderr: '', task: t.title };
}

export function getLastCompletedSession(): {
  task: string;
  status: string;
  stdout: string;
  stderr: string;
  completedAt: number;
  gitResult?: GitSyncResult;
} | null {
  const recent = listTasks({ limit: 1 });
  if (!recent.length) return null;
  const t = recent[0];
  if (t.status === 'running') return null;
  let gitResult: GitSyncResult | undefined;
  try {
    const meta = t.meta_json ? JSON.parse(t.meta_json) : {};
    if (meta.lastGit) gitResult = meta.lastGit;
  } catch { /* ignore */ }
  return {
    task: t.title,
    status: t.status,
    stdout: t.last_summary || '',
    stderr: '',
    completedAt: t.ended_at_ms || t.last_active_at_ms,
    gitResult,
  };
}

export function clearLastCompletedSession(): void {
  // No-op now that tasks are persistent. Kept for compatibility.
}

/** Back-compat: legacy WS layer queries this for the "currently active copilot session" banner. */
export function getActiveSession(): { task: string; startedAt: number; pid?: number; taskId: string } | null {
  const active = getActiveTurn();
  if (!active) return null;
  const t = getTask(active.taskId);
  return {
    task: t?.title || active.taskId,
    startedAt: active.startedAt,
    pid: active.pid,
    taskId: active.taskId,
  };
}

let _fallbackInjector: ((task: string, status: string, stdout: string, stderr: string, gitResult?: GitSyncResult) => void) | null = null;
export function setFallbackInjector(fn: typeof _fallbackInjector) {
  _fallbackInjector = fn;
}
export function getFallbackInjector() { return _fallbackInjector; }

let _hookDelivered = false;
export function markHookDelivered() { _hookDelivered = true; }
export function consumeHookDelivered(): boolean { const v = _hookDelivered; _hookDelivered = false; return v; }

// ---------------------------------------------------------------------------
// copilot_dispatch — create a new task and run its first turn
// ---------------------------------------------------------------------------

export const copilotDispatchHandler: FunctionHandler = {
  schema: {
    name: 'copilot_dispatch',
    type: 'function',
    description:
      'Dispatch a new task to the background Copilot CLI agent. Returns immediately with a task id — results stream into the task and are delivered asynchronously. The agent can browse the web (via Playwright), read/write files in the task\'s isolated subfolder, and perform multi-step tasks. If the task pauses needing user help (e.g. login wall), it transitions to status `awaiting_user` and you can resume it later with `copilot_continue`.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Natural language description of the task to perform. Be specific about what you want accomplished. Becomes the task title.',
        },
        notify: {
          type: 'string',
          description: "How the user wants the result delivered when the task finishes, e.g. 'sms', 'email', 'chat', or a specific address. Defaults to SMS if the user didn't state a preference. Recorded on the task so the completion notification can honor it — you no longer need to create a note for this.",
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },

  handler: async (
    args: { task: string; notify?: string },
    addBreadcrumb?: (title: string, data?: any) => void,
  ): Promise<any> => {
    const task = String(args?.task || '').trim();
    if (!task) return { error: 'task is required' };
    const notify = typeof args?.notify === 'string' && args.notify.trim() ? args.notify.trim() : null;

    // Preflight: Copilot token presence is the gate (browser stack follows).
    if (!isBrowserStackEnabled()) {
      return { error: 'Copilot is not configured. Open Settings → Browser / Copilot and add your COPILOT_GITHUB_TOKEN.' };
    }
    if (!configService.get('COPILOT_GITHUB_TOKEN')) {
      return { error: 'COPILOT_GITHUB_TOKEN not set. Open Settings → Browser and add your Copilot Sign-In Token.' };
    }

    const active = getActiveTurn();
    if (active) {
      const existing = getTask(active.taskId);
      return {
        error: `A copilot task is already running (id: ${active.taskId}, title: "${existing?.title?.slice(0, 80) || ''}"). Wait for it to finish, or call copilot_continue on that task.`,
      };
    }

    // Pull conversation id (best-effort) so we can link task ↔ chat
    let originatingConversationId: string | null = null;
    try {
      const sess = require('../../session/state').session;
      originatingConversationId = (sess as any)?.currentConversationId || null;
    } catch { /* ignore */ }

    addBreadcrumb?.('Copilot task created', { taskPrefix: task.slice(0, 80) });

    const result = await createTaskWithFirstTurn({
      prompt: task,
      source: 'chat-agent',
      via: 'chat',
      originatingConversationId,
      notify,
    });
    if (result.error) return { error: result.error };

    const taskUrl = buildTaskUrl(result.task.id);
    return {
      status: 'dispatched',
      task_id: result.task.id,
      title: result.task.title,
      task_url: taskUrl,
      notify,
      message: `Task ${result.task.id} ("${result.task.title}") started. Share this link with the user so they can watch progress and read the outputs: ${taskUrl}. When it finishes you'll get a notification — deliver the result via the recorded preference (${notify || 'SMS by default'}) and include the link. Do NOT create a note for task tracking.`,
    };
  },
};

// ---------------------------------------------------------------------------
// copilot_status (legacy) — status of the most recent task
// ---------------------------------------------------------------------------

export const copilotGetResultHandler: FunctionHandler = {
  schema: {
    name: 'copilot_status',
    type: 'function',
    description:
      'Check the status of the most recent Copilot task. Returns the live or completed status, the task id, and a tail of the output. For a specific task, prefer copilot_task_status.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },

  handler: async (
    _args: Record<string, never>,
    addBreadcrumb?: (title: string, data?: any) => void,
  ): Promise<any> => {
    const active = getActiveTurn();
    if (active) {
      const t = getTask(active.taskId);
      const elapsed = Math.round((Date.now() - active.startedAt) / 1000);
      addBreadcrumb?.('copilot_status — active', { taskId: active.taskId, elapsed });
      return {
        status: 'running',
        task_id: active.taskId,
        task: t?.title || 'unknown',
        task_url: buildTaskUrl(active.taskId),
        elapsedSeconds: elapsed,
        outputTail: (t?.last_summary || '').slice(-1200),
      };
    }
    const recent = listTasks({ limit: 1 });
    if (!recent.length) {
      addBreadcrumb?.('copilot_status — none');
      return { status: 'none', message: 'No copilot task has run yet.' };
    }
    const t = recent[0];
    addBreadcrumb?.('copilot_status — most recent', { id: t.id, status: t.status });
    return {
      status: t.status,
      task_id: t.id,
      task: t.title,
      task_url: buildTaskUrl(t.id),
      needs_user_reason: t.needs_user_reason || undefined,
      completedAt: t.ended_at_ms ? new Date(t.ended_at_ms).toISOString() : undefined,
      output: t.last_summary || '',
    };
  },
};

// ---------------------------------------------------------------------------
// copilot_continue — enqueue a new prompt on an existing task
// ---------------------------------------------------------------------------

export const copilotContinueHandler: FunctionHandler = {
  schema: {
    name: 'copilot_continue',
    type: 'function',
    description:
      'Send a new instruction to an existing Copilot task — resumes the same Copilot session in its saved working subfolder. Use this when the user wants to keep working on a task (e.g. "tell my Coles task I\'m logged in"). Identify the task by its id (e.g. `c4f-coles-shopping`) or by a fuzzy match on its title.',
    parameters: {
      type: 'object',
      properties: {
        task_id_or_name: {
          type: 'string',
          description: 'Either the task id (preferred) or part of the task title to fuzzy-match. Most recent match wins.',
        },
        prompt: {
          type: 'string',
          description: 'The new instruction to send to the task.',
        },
      },
      required: ['task_id_or_name', 'prompt'],
      additionalProperties: false,
    },
  },

  handler: async (
    args: { task_id_or_name: string; prompt: string },
    addBreadcrumb?: (title: string, data?: any) => void,
  ): Promise<any> => {
    const query = String(args?.task_id_or_name || '').trim();
    const prompt = String(args?.prompt || '').trim();
    if (!query) return { error: 'task_id_or_name is required' };
    if (!prompt) return { error: 'prompt is required' };

    if (!isBrowserStackEnabled()) {
      return { error: 'Copilot is not configured.' };
    }

    const task = findTaskByName(query);
    if (!task) return { error: `No task found matching: ${query}` };

    addBreadcrumb?.('copilot_continue', { taskId: task.id });

    try {
      const result = enqueueInput({
        taskId: task.id,
        prompt,
        source: 'chat-agent',
        via: 'chat',
      });
      return {
        status: result.willStartImmediately ? 'started' : 'queued',
        task_id: task.id,
        title: task.title,
        message: result.willStartImmediately
          ? `Resumed task ${task.id}. Output will stream into the task; check status with copilot_task_status.`
          : `Queued instruction on task ${task.id} (another turn is already running). It will run next.`,
      };
    } catch (err: any) {
      return { error: err?.message || 'Failed to enqueue input' };
    }
  },
};

// ---------------------------------------------------------------------------
// copilot_task_status — read-only summary of any task (no new Copilot turn)
// ---------------------------------------------------------------------------

export const copilotTaskStatusHandler: FunctionHandler = {
  schema: {
    name: 'copilot_task_status',
    type: 'function',
    description:
      'Read-only summary of a Copilot task — status, title, last summary, recent output tail, last NEEDS_USER reason if any. Does NOT spend a new Copilot turn. Pass omit task_id_or_name to get the most recent task.',
    parameters: {
      type: 'object',
      properties: {
        task_id_or_name: {
          type: 'string',
          description: 'Task id or partial title. Omit to get the most recent task.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },

  handler: async (
    args: { task_id_or_name?: string },
    addBreadcrumb?: (title: string, data?: any) => void,
  ): Promise<any> => {
    let task: CopilotTaskRow | null = null;
    if (args?.task_id_or_name) {
      task = findTaskByName(args.task_id_or_name);
      if (!task) return { error: `No task found matching: ${args.task_id_or_name}` };
    } else {
      const recent = listTasks({ limit: 1 });
      if (!recent.length) return { status: 'none', message: 'No copilot task has run yet.' };
      task = recent[0];
    }
    addBreadcrumb?.('copilot_task_status', { id: task.id, status: task.status });
    const summary = summarizeTask(task.id);
    let notify: string | null = null;
    try { const m = task.meta_json ? JSON.parse(task.meta_json) : {}; notify = m?.notify ?? null; } catch { /* ignore */ }
    return {
      task_id: task.id,
      title: task.title,
      status: task.status,
      task_url: buildTaskUrl(task.id),
      notify,
      copilot_session_id: task.copilot_session_id,
      turn_count: task.turn_count,
      created_at: new Date(task.created_at_ms).toISOString(),
      last_active_at: new Date(task.last_active_at_ms).toISOString(),
      ended_at: task.ended_at_ms ? new Date(task.ended_at_ms).toISOString() : null,
      needs_user_reason: task.needs_user_reason || null,
      last_prompt: task.last_prompt || null,
      last_summary: task.last_summary || null,
      recent_output_tail: summary?.recentOutput?.slice(-2000) || '',
    };
  },
};

// ---------------------------------------------------------------------------
// Backwards-compatible alias for the existing route module
// ---------------------------------------------------------------------------

export function cancelTask(taskId: string) { return cancelActiveTurn(taskId); }
