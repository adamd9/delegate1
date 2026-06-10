/**
 * Copilot task runner — process management + input queue.
 *
 * One Copilot child runs system-wide at any moment (matches the underlying single-VNC/single-browser
 * constraint). Each task has its own FIFO input queue; turns drain one at a time.
 *
 * Lifecycle of a turn:
 *   1. enqueueInput(taskId, prompt, source) appends to the queue + emits 'user_prompt' event.
 *   2. processNextTurn() runs the next item if no Copilot is currently running.
 *   3. spawn `copilot -C <subfolder> -n "<title>" [--resume <UUID>] -p "<wrapped prompt>"`
 *   4. stream stdout/stderr into events; append to task's events table; broadcast over WS.
 *   5. on close: parse NEEDS_USER, commit+push, set final status, drain queue.
 */

import { spawn, execFile, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { homedir } from 'os';
import {
  COPILOT_WORK_DIR,
  COPILOT_HOME_DIR,
  BROWSER_PROFILE_DIR,
  commitAndPushWorkDir,
  GLOBAL_LOG_FILE,
  GitSyncResult,
} from '../browser';
import { configService } from '../config';
import { getPort } from '../server/config/env';
import {
  CopilotTaskRow,
  TaskStatus,
  addEvent,
  generateTaskId,
  getTask,
  insertTask,
  listEvents,
  updateTask,
  incrementTurnCount,
  listTasks,
} from './tasks';

// ---------------------------------------------------------------------------
// Shared single-task lock
// ---------------------------------------------------------------------------

interface ActiveTurn {
  taskId: string;
  child: ChildProcess;
  startedAt: number;
  prompt: string;
  source: string;
  stdoutBuf: string;
  stderrBuf: string;
  cancelled?: boolean;
}

let activeTurn: ActiveTurn | null = null;

export function getActiveTurn(): { taskId: string; startedAt: number; pid?: number; source: string } | null {
  if (!activeTurn) return null;
  return {
    taskId: activeTurn.taskId,
    startedAt: activeTurn.startedAt,
    pid: activeTurn.child.pid,
    source: activeTurn.source,
  };
}

// ---------------------------------------------------------------------------
// Broadcast hook (set by ws layer)
// ---------------------------------------------------------------------------

export interface TaskBroadcast {
  type: string;
  taskId?: string;
  [k: string]: any;
}

let broadcastFn: ((msg: TaskBroadcast) => void) | null = null;
export function setTaskBroadcast(fn: ((msg: TaskBroadcast) => void) | null) {
  broadcastFn = fn;
}
function emit(msg: TaskBroadcast) {
  try { broadcastFn?.(msg); } catch (err) { console.error('[copilot-tasks] broadcast error', err); }
}

// ---------------------------------------------------------------------------
// Per-task input queue
// ---------------------------------------------------------------------------

interface QueuedInput {
  prompt: string;
  source: string;             // 'user-direct' | 'chat-agent' | 'voice' | 'system'
  via?: string;               // 'tasks-ui' | 'chat' | 'voice' | 'phone'
  enqueuedAt: number;
  eventId: number;            // id of the user_prompt event we recorded
}

const queues = new Map<string, QueuedInput[]>();
function queueFor(taskId: string): QueuedInput[] {
  let q = queues.get(taskId);
  if (!q) { q = []; queues.set(taskId, q); }
  return q;
}

export function getQueuedInputs(taskId: string): QueuedInput[] {
  return queueFor(taskId).slice();
}

// ---------------------------------------------------------------------------
// Copilot CLI binary discovery (cached)
// ---------------------------------------------------------------------------

let copilotCache: { path: string; ghMode: boolean } | null | undefined;

function getCopilotInfo(): Promise<{ path: string; ghMode: boolean } | null> {
  return new Promise((resolve) => {
    if (copilotCache !== undefined) return resolve(copilotCache);
    execFile('which', ['copilot'], (err, stdout) => {
      if (!err && stdout.trim()) {
        copilotCache = { path: stdout.trim(), ghMode: false };
        return resolve(copilotCache);
      }
      const home = homedir() || '/root';
      const knownBin = `${home}/.local/share/gh/copilot/copilot`;
      if (fs.existsSync(knownBin)) {
        copilotCache = { path: knownBin, ghMode: false };
        return resolve(copilotCache);
      }
      execFile('which', ['gh'], (err2, stdout2) => {
        if (!err2 && stdout2.trim()) {
          copilotCache = { path: stdout2.trim(), ghMode: true };
          return resolve(copilotCache);
        }
        copilotCache = null;
        resolve(null);
      });
    });
  });
}

export function resetCopilotBinaryCache() {
  copilotCache = undefined;
}

// ---------------------------------------------------------------------------
// Workdir layout
// ---------------------------------------------------------------------------

export function taskWorkdir(taskId: string): string {
  return path.join(COPILOT_WORK_DIR, 'tasks', taskId);
}

function ensureTaskWorkdir(taskId: string, title: string): string {
  const dir = taskWorkdir(taskId);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, `# ${title}\n\nTask id: \`${taskId}\`\nCreated: ${new Date().toISOString()}\n`);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Session UUID capture
// ---------------------------------------------------------------------------

function sessionStateDir(): string {
  return path.join(COPILOT_HOME_DIR, 'session-state');
}

function listSessionUuids(): Array<{ uuid: string; mtimeMs: number }> {
  try {
    const dir = sessionStateDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .map(name => {
        try {
          const stat = fs.statSync(path.join(dir, name));
          if (!stat.isDirectory()) return null;
          // UUID-ish check
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return null;
          return { uuid: name, mtimeMs: stat.mtimeMs };
        } catch { return null; }
      })
      .filter((x): x is { uuid: string; mtimeMs: number } => x !== null);
  } catch { return []; }
}

/** Find the session-state directory created or modified after `sinceMs`. Used to capture the UUID a fresh run produced. */
function findNewestSessionSince(sinceMs: number): string | null {
  const candidates = listSessionUuids()
    .filter(s => s.mtimeMs >= sinceMs - 1000) // small allowance
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.uuid || null;
}

// ---------------------------------------------------------------------------
// NEEDS_USER parser
// ---------------------------------------------------------------------------

const NEEDS_USER_RE = /^\s*NEEDS_USER\s*:\s*(.+?)\s*$/im;

function parseNeedsUser(text: string): string | null {
  const m = text.match(NEEDS_USER_RE);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Prompt wrapping
// ---------------------------------------------------------------------------

function wrapPrompt(prompt: string, source: string, via?: string): string {
  const at = new Date().toISOString();
  const viaPart = via ? `, via: ${via}` : '';
  return `[FROM: ${source}${viaPart}, at: ${at}]\n${prompt}`;
}

// ---------------------------------------------------------------------------
// Public API: create a task + first turn (used by copilot_dispatch)
// ---------------------------------------------------------------------------

export async function createTaskWithFirstTurn(opts: {
  title?: string;
  prompt: string;
  source?: string;
  via?: string;
  originatingConversationId?: string | null;
}): Promise<{ task: CopilotTaskRow; error?: string }> {
  const preflight = preflightChecks();
  if (preflight.error) return { task: null as any, error: preflight.error };

  const title = (opts.title && opts.title.trim()) || autoTitleFromPromptShort(opts.prompt);
  const id = generateTaskId(title);
  const workdir = ensureTaskWorkdir(id, title);

  const task = insertTask({
    id,
    title,
    status: 'running',
    workdir,
    originating_conversation_id: opts.originatingConversationId ?? null,
    meta: { source: opts.source || 'chat-agent', via: opts.via || 'chat' },
  });

  emit({ type: 'copilot.task.created', taskId: id, task });

  // Enqueue + try to start immediately
  enqueueInput({
    taskId: id,
    prompt: opts.prompt,
    source: opts.source || 'chat-agent',
    via: opts.via || 'chat',
  });
  // Try to drain (will start the first turn if free)
  processNextTurn().catch(err => console.error('[copilot-tasks] processNextTurn error', err));

  return { task };
}

function autoTitleFromPromptShort(prompt: string): string {
  const first = (prompt || '').split('\n')[0].trim();
  if (!first) return 'Untitled task';
  return first.length > 80 ? first.slice(0, 79) + '…' : first;
}

// ---------------------------------------------------------------------------
// Public API: enqueue input on an existing task (used by /continue, copilot_continue tool)
// ---------------------------------------------------------------------------

export function enqueueInput(opts: {
  taskId: string;
  prompt: string;
  source: string;
  via?: string;
}): { event: { id: number }; queued: boolean; willStartImmediately: boolean } {
  const task = getTask(opts.taskId);
  if (!task) throw new Error(`Task not found: ${opts.taskId}`);
  if (task.archived) throw new Error(`Task is archived: ${opts.taskId}`);

  const event = addEvent({
    task_id: opts.taskId,
    kind: 'user_prompt',
    payload: { prompt: opts.prompt, source: opts.source, via: opts.via ?? null },
  });
  emit({ type: 'copilot.task.event', taskId: opts.taskId, event });

  const willStart = !activeTurn;
  queueFor(opts.taskId).push({
    prompt: opts.prompt,
    source: opts.source,
    via: opts.via,
    enqueuedAt: Date.now(),
    eventId: event.id,
  });

  // If nothing is running, try to drain now
  if (!activeTurn) {
    processNextTurn().catch(err => console.error('[copilot-tasks] processNextTurn error', err));
  }
  return { event: { id: event.id }, queued: !willStart, willStartImmediately: willStart };
}

// ---------------------------------------------------------------------------
// Public API: cancel a task's currently running turn
// ---------------------------------------------------------------------------

export function cancelActiveTurn(taskId: string): { cancelled: boolean; reason?: string } {
  if (!activeTurn) return { cancelled: false, reason: 'no active turn' };
  if (activeTurn.taskId !== taskId) {
    return { cancelled: false, reason: `active turn is for a different task: ${activeTurn.taskId}` };
  }
  activeTurn.cancelled = true;
  try { activeTurn.child.kill('SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => {
    if (activeTurn && activeTurn.taskId === taskId) {
      try { activeTurn.child.kill('SIGKILL'); } catch { /* no-op */ }
    }
  }, 30_000);
  return { cancelled: true };
}

// ---------------------------------------------------------------------------
// Preflight + binary helpers
// ---------------------------------------------------------------------------

function preflightChecks(): { error?: string } {
  if (configService.get('BROWSER_ENABLED') !== 'true') {
    return { error: 'Browser agent not enabled. Set BROWSER_ENABLED=true to use this tool.' };
  }
  if (!configService.get('COPILOT_GITHUB_TOKEN')) {
    return { error: 'Copilot Sign-In Token is not configured. Open Settings → Browser, enter your Copilot Sign-In Token, and save.' };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Core: process the next queued input across all tasks
// ---------------------------------------------------------------------------

async function processNextTurn(): Promise<void> {
  if (activeTurn) return;

  // Find a task whose queue is non-empty.
  // Prefer the task whose current status is 'running' (i.e. the one that just had work enqueued).
  // Otherwise FIFO across the union of queues by oldest enqueuedAt.
  let chosenTaskId: string | null = null;
  let chosenItem: QueuedInput | null = null;
  let oldest = Infinity;
  for (const [tid, q] of queues.entries()) {
    if (q.length === 0) continue;
    const head = q[0];
    if (head.enqueuedAt < oldest) {
      oldest = head.enqueuedAt;
      chosenTaskId = tid;
      chosenItem = head;
    }
  }
  if (!chosenTaskId || !chosenItem) return;

  const task = getTask(chosenTaskId);
  if (!task) {
    // Stale queue; drop and recurse
    queueFor(chosenTaskId).shift();
    return processNextTurn();
  }

  const copilotInfo = await getCopilotInfo();
  if (!copilotInfo) {
    copilotCache = undefined;
    addEvent({
      task_id: chosenTaskId,
      kind: 'system',
      payload: { text: 'Copilot CLI not installed or not in PATH.' },
    });
    updateTask(chosenTaskId, { status: 'failed', ended_at_ms: Date.now() });
    queueFor(chosenTaskId).shift();
    emit({ type: 'copilot.task.update', taskId: chosenTaskId });
    return;
  }

  // Pop the queued input now that we're committed to running it
  queueFor(chosenTaskId).shift();

  // Make sure workdir exists
  const cwd = ensureTaskWorkdir(chosenTaskId, task.title);

  const port = String(getPort());
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    COPILOT_GITHUB_TOKEN: configService.get('COPILOT_GITHUB_TOKEN') || '',
    COPILOT_HOME: COPILOT_HOME_DIR || '',
    PLAYWRIGHT_CLI_SESSION: 'delegate',
    PLAYWRIGHT_DAEMON_SESSION_DIR: BROWSER_PROFILE_DIR,
    AGENT_CALLBACK_URL: `http://localhost:${port}`,
    COPILOT_TASK_ID: chosenTaskId,
  };

  const wrappedPrompt = wrapPrompt(chosenItem.prompt, chosenItem.source, chosenItem.via);

  const baseArgs: string[] = [];
  // Resume if we already know the session UUID for this task; otherwise create a new named session
  if (task.copilot_session_id) {
    baseArgs.push('--resume', task.copilot_session_id);
  } else {
    baseArgs.push('-n', task.title.slice(0, 60));
  }
  baseArgs.push('-p', wrappedPrompt, '--no-ask-user', '--yolo', '--agent=delegate-browser');

  const spawnArgs = copilotInfo.ghMode ? ['copilot', ...baseArgs] : baseArgs;

  const sinceMs = Date.now();

  // Persist a turn_start event
  const turnStartEvent = addEvent({
    task_id: chosenTaskId,
    kind: 'turn_start',
    payload: {
      promptEventId: chosenItem.eventId,
      source: chosenItem.source,
      via: chosenItem.via,
      resumedSessionId: task.copilot_session_id,
    },
  });
  emit({ type: 'copilot.task.event', taskId: chosenTaskId, event: turnStartEvent });

  updateTask(chosenTaskId, { status: 'running', last_prompt: chosenItem.prompt });
  incrementTurnCount(chosenTaskId);
  emit({ type: 'copilot.task.update', taskId: chosenTaskId });

  // Append a marker to the shared log for the persistent VNC xterm
  try {
    fs.appendFileSync(
      GLOBAL_LOG_FILE,
      `\n${'═'.repeat(60)}\n` +
        `TASK ${chosenTaskId} — TURN STARTED  ${new Date().toISOString()}\n` +
        `Source: ${chosenItem.source}${chosenItem.via ? ` (via ${chosenItem.via})` : ''}\n` +
        `Prompt: ${chosenItem.prompt.slice(0, 200)}${chosenItem.prompt.length > 200 ? '…' : ''}\n` +
        `${'═'.repeat(60)}\n\n`
    );
  } catch { /* non-fatal */ }

  const timeoutMs = parseInt(configService.get('COPILOT_TIMEOUT_MS') || '1800000', 10);
  const sigkillGraceMs = 30_000;

  const child = spawn(copilotInfo.path, spawnArgs, { cwd, env, stdio: 'pipe' });
  activeTurn = {
    taskId: chosenTaskId,
    child,
    startedAt: Date.now(),
    prompt: chosenItem.prompt,
    source: chosenItem.source,
    stdoutBuf: '',
    stderrBuf: '',
  };

  emit({ type: 'copilot.task.turn_start', taskId: chosenTaskId, pid: child.pid });

  let stdoutFlushTimer: NodeJS.Timeout | null = null;
  const flushStdout = () => {
    if (!activeTurn || !activeTurn.stdoutBuf) return;
    const text = activeTurn.stdoutBuf;
    activeTurn.stdoutBuf = '';
    const ev = addEvent({ task_id: chosenTaskId!, kind: 'agent_output', payload: { text } });
    emit({ type: 'copilot.task.event', taskId: chosenTaskId!, event: ev });
  };

  child.stdout.on('data', (chunk: Buffer) => {
    if (!activeTurn) return;
    const text = chunk.toString();
    activeTurn.stdoutBuf += text;
    try { fs.appendFileSync(GLOBAL_LOG_FILE, text); } catch { /* non-fatal */ }
    // Flush on newline boundaries to keep events readable but cheap
    if (text.includes('\n')) {
      if (stdoutFlushTimer) { clearTimeout(stdoutFlushTimer); stdoutFlushTimer = null; }
      flushStdout();
    } else if (!stdoutFlushTimer) {
      stdoutFlushTimer = setTimeout(() => { stdoutFlushTimer = null; flushStdout(); }, 250);
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    if (!activeTurn) return;
    const text = chunk.toString();
    activeTurn.stderrBuf += text;
    try { fs.appendFileSync(GLOBAL_LOG_FILE, `[stderr] ${text}`); } catch { /* non-fatal */ }
    const ev = addEvent({ task_id: chosenTaskId!, kind: 'agent_stderr', payload: { text } });
    emit({ type: 'copilot.task.event', taskId: chosenTaskId!, event: ev });
  });

  const timer = setTimeout(() => {
    if (!activeTurn) return;
    activeTurn.cancelled = true;
    try { child.kill('SIGTERM'); } catch { /* no-op */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* no-op */ } }, sigkillGraceMs);
  }, timeoutMs);

  child.on('error', (err) => {
    clearTimeout(timer);
    if (stdoutFlushTimer) { clearTimeout(stdoutFlushTimer); stdoutFlushTimer = null; }
    flushStdout();
    addEvent({
      task_id: chosenTaskId!,
      kind: 'system',
      payload: { text: `process error: ${err.message}` },
    });
    updateTask(chosenTaskId!, { status: 'failed', ended_at_ms: Date.now() });
    emit({ type: 'copilot.task.update', taskId: chosenTaskId! });
    activeTurn = null;
    processNextTurn().catch(e => console.error('[copilot-tasks] processNextTurn error', e));
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (stdoutFlushTimer) { clearTimeout(stdoutFlushTimer); stdoutFlushTimer = null; }
    flushStdout();

    const turn = activeTurn;
    activeTurn = null;
    const completedStdout = turn?.stdoutBuf || '';
    if (completedStdout) {
      const ev = addEvent({ task_id: chosenTaskId!, kind: 'agent_output', payload: { text: completedStdout } });
      emit({ type: 'copilot.task.event', taskId: chosenTaskId!, event: ev });
    }

    // Aggregate this turn's full stdout from events for parsing NEEDS_USER + summary
    const events = listEvents(chosenTaskId!).filter(e => e.id >= turnStartEvent.id);
    const fullStdout = events.filter(e => e.kind === 'agent_output').map(e => String(e.payload?.text || '')).join('');
    const needs = parseNeedsUser(fullStdout);

    let status: TaskStatus;
    if (turn?.cancelled) status = 'awaiting_user';
    else if (code !== 0) status = 'failed';
    else if (needs) status = 'awaiting_user';
    else status = 'completed';

    if (needs) {
      const ev = addEvent({ task_id: chosenTaskId!, kind: 'needs_user', payload: { reason: needs } });
      emit({ type: 'copilot.task.event', taskId: chosenTaskId!, event: ev });
    }
    if (turn?.cancelled) {
      const ev = addEvent({ task_id: chosenTaskId!, kind: 'cancelled', payload: { reason: 'user cancelled' } });
      emit({ type: 'copilot.task.event', taskId: chosenTaskId!, event: ev });
    }

    // Capture session UUID if we didn't already have one
    const currentRow = getTask(chosenTaskId!);
    let sessionUuid = currentRow?.copilot_session_id || null;
    if (!sessionUuid) {
      sessionUuid = findNewestSessionSince(sinceMs);
    }

    // Last summary = tail of stdout, short
    const lastSummary = fullStdout.trim().slice(-600);

    // Git commit + push (non-fatal)
    let gitResult: GitSyncResult | undefined;
    try {
      gitResult = commitAndPushWorkDir(`task ${chosenTaskId} — ${currentRow?.title || ''}`);
      addEvent({
        task_id: chosenTaskId!,
        kind: 'git_sync',
        payload: { status: gitResult.status, message: gitResult.message },
      });
    } catch (err: any) {
      addEvent({
        task_id: chosenTaskId!,
        kind: 'system',
        payload: { text: `git sync error: ${err?.message || err}` },
      });
    }

    const turnEndEv = addEvent({
      task_id: chosenTaskId!,
      kind: 'turn_end',
      payload: {
        exitCode: code,
        status,
        needs_user_reason: needs || null,
        cancelled: !!turn?.cancelled,
      },
    });
    emit({ type: 'copilot.task.event', taskId: chosenTaskId!, event: turnEndEv });

    updateTask(chosenTaskId!, {
      status,
      ended_at_ms: Date.now(),
      needs_user_reason: needs || null,
      last_summary: lastSummary,
      copilot_session_id: sessionUuid,
      meta: {
        ...(currentRow?.meta_json ? JSON.parse(currentRow.meta_json) : {}),
        lastExitCode: code,
        lastGit: gitResult ? { status: gitResult.status, message: gitResult.message } : undefined,
      },
    });
    emit({ type: 'copilot.task.update', taskId: chosenTaskId! });

    try {
      fs.appendFileSync(
        GLOBAL_LOG_FILE,
        `\n${'═'.repeat(60)}\n` +
          `TASK ${chosenTaskId} — TURN ENDED status=${status} code=${code}\n` +
          (needs ? `NEEDS_USER: ${needs}\n` : '') +
          `${'═'.repeat(60)}\n\n`
      );
    } catch { /* non-fatal */ }

    // Drain next item (could be queued on the same task or another)
    processNextTurn().catch(e => console.error('[copilot-tasks] processNextTurn error', e));
  });
}

// ---------------------------------------------------------------------------
// Startup reconciliation
// ---------------------------------------------------------------------------

export function reconcileOnStartup(): void {
  try {
    const stuck = listTasks({ includeArchived: false, statuses: ['running'] });
    for (const t of stuck) {
      updateTask(t.id, {
        status: 'awaiting_user',
        needs_user_reason: 'Process was interrupted by a server restart. Resume with a new instruction when ready.',
        ended_at_ms: Date.now(),
      });
      addEvent({
        task_id: t.id,
        kind: 'system',
        payload: { text: 'Server restarted while this task was running. Status reset to awaiting_user.' },
      });
    }
    if (stuck.length) {
      console.log(`[copilot-tasks] reconciled ${stuck.length} stuck running tasks → awaiting_user`);
    }
  } catch (err: any) {
    console.warn('[copilot-tasks] reconcile error', err?.message || err);
  }
}
