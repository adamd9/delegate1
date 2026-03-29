import { FunctionHandler } from '../../agentConfigs/types';
import { spawn, ChildProcess } from 'child_process';
import { execFile } from 'child_process';
import fs from 'fs';
import { COPILOT_WORK_DIR, COPILOT_HOME_DIR, commitAndPushWorkDir, GLOBAL_LOG_FILE } from '../../browser';

// GLOBAL_LOG_FILE is imported from browser/index.ts — it is an append-only log
// file tailed by the persistent xterm in the VNC display.

// Single-session enforcement
let activeSession: { child: ChildProcess; task: string; startedAt: number; stdout: string; stderr: string } | null = null;

// Preserved output from the last completed session (for copilot_status)
let lastCompletedSession: { task: string; status: string; stdout: string; stderr: string; completedAt: number } | null = null;

export function getActiveSession() {
  return activeSession
    ? { task: activeSession.task, startedAt: activeSession.startedAt, pid: activeSession.child.pid }
    : null;
}

export function getSessionOutput(): { stdout: string; stderr: string; task: string } | null {
  if (!activeSession) return null;
  return {
    stdout: activeSession.stdout,
    stderr: activeSession.stderr,
    task: activeSession.task,
  };
}

export function getLastCompletedSession() {
  return lastCompletedSession;
}

export function clearLastCompletedSession() {
  lastCompletedSession = null;
}

// Broadcast callback — set by the WS layer so handler can push stdout/stderr chunks
let broadcastFn: ((msg: { type: string; [k: string]: any }) => void) | null = null;
export function setCopilotBroadcast(fn: ((msg: { type: string; [k: string]: any }) => void) | null) {
  broadcastFn = fn;
}

// Fallback injector — set by the callback route so the close handler can inject
// results if hooks didn't fire (crash, misconfiguration, etc.)
let fallbackInjector: ((task: string, status: string, stdout: string, stderr: string) => void) | null = null;
export function setFallbackInjector(fn: ((task: string, status: string, stdout: string, stderr: string) => void) | null) {
  fallbackInjector = fn;
}

// Called by the callback route when a sessionEnd hook successfully delivers
let export_setHookDelivered: ((v: boolean) => void) | null = null;
export function markHookDelivered() {
  export_setHookDelivered?.(true);
}

// Cache resolved binary path + mode across invocations
let copilotCache: { path: string; ghMode: boolean } | null | undefined; // undefined = not checked yet

function getCopilotInfo(): Promise<{ path: string; ghMode: boolean } | null> {
  return new Promise((resolve) => {
    if (copilotCache !== undefined) {
      return resolve(copilotCache);
    }
    // Try standalone `copilot` first
    execFile('which', ['copilot'], (err, stdout) => {
      if (!err && stdout.trim()) {
        copilotCache = { path: stdout.trim(), ghMode: false };
        return resolve(copilotCache);
      }
      // Check the well-known path where `gh copilot` auto-downloads the binary
      const home = process.env.HOME || '/root';
      const knownBin = `${home}/.local/share/gh/copilot/copilot`;
      if (require('fs').existsSync(knownBin)) {
        copilotCache = { path: knownBin, ghMode: false };
        return resolve(copilotCache);
      }
      // Fall back to `gh copilot` wrapper (only if gh is present)
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

export const copilotDispatchHandler: FunctionHandler = {
  schema: {
    name: 'copilot_dispatch',
    type: 'function',
    description:
      'Dispatch a task to a background Copilot CLI agent. Returns immediately — results are delivered asynchronously. The agent can browse the web (via Playwright), read/write files, and perform multi-step tasks. Use for web research, data extraction, and browser automation.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Natural language description of the task to perform. Be specific about what you want accomplished.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },

  handler: async (
    args: { task: string },
    addBreadcrumb?: (title: string, data?: any) => void,
  ): Promise<any> => {
    try {
      const { task } = args;

      const truncatedTask = task.length > 120 ? task.slice(0, 120) + '…' : task;
      addBreadcrumb?.('Copilot dispatch started', { task: truncatedTask });

      // 0. Single-session enforcement
      if (activeSession) {
        return {
          error: `A copilot session is already running (started ${new Date(activeSession.startedAt).toISOString()}, task: "${activeSession.task.slice(0, 80)}"). Wait for it to finish.`,
        };
      }

      // 1. Check BROWSER_ENABLED
      if (process.env.BROWSER_ENABLED !== 'true') {
        return {
          error: 'Browser agent not enabled. Set BROWSER_ENABLED=true to use this tool.',
        };
      }

      // 2. Check auth token
      if (!process.env.COPILOT_GITHUB_TOKEN) {
        return {
          error: 'COPILOT_GITHUB_TOKEN not set. Provide a GitHub PAT with Copilot permissions.',
        };
      }

      // 3. Check copilot CLI availability
      const copilotInfo = await getCopilotInfo();
      if (!copilotInfo) {
        // Clear cache so next call re-checks (binary may appear after entrypoint finishes)
        copilotCache = undefined;
        return { error: 'Copilot CLI not installed or not in PATH. Checked `copilot`, known gh binary path, and `gh`.' };
      }

      // 4. Resolve working directory — ensure it exists, fall back to cwd
      let cwd = COPILOT_WORK_DIR || process.cwd();
      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
      }

      // 5. Build env
      const port = process.env.PORT || '8081';
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        COPILOT_GITHUB_TOKEN: process.env.COPILOT_GITHUB_TOKEN,
        COPILOT_HOME: process.env.COPILOT_HOME || COPILOT_HOME_DIR || '',
        PLAYWRIGHT_CLI_SESSION: 'delegate',
        AGENT_CALLBACK_URL: `http://localhost:${port}`,
      };
      if (process.env.DISPLAY) {
        env.DISPLAY = process.env.DISPLAY;
      }

      // 6. Timeout — default 30 min for research/browsing tasks.
      // Copilot CLI catches SIGTERM and finishes its current step before exiting,
      // so we send SIGTERM first and escalate to SIGKILL after a 30 s grace period.
      const timeoutMs = parseInt(process.env.COPILOT_TIMEOUT_MS || '1800000', 10);
      const sigkillGraceMs = 30000;

      // 7. Spawn copilot process (async — returns immediately, results via hooks)
      // Per docs: -p (prompt) + --no-ask-user + --yolo + --agent
      // -s (silent/scriptable) is intentionally omitted so the full reasoning trace
      // is written to the log file and visible in the VNC terminal.
      // --share writes the full session transcript to a file as an additional fallback.
      const sessionShareFile = '/tmp/copilot-session-share.md';

      // If a prior session exists, prepend its summary as context so the agent knows
      // what was already accomplished and can continue naturally.
      let effectiveTask = task;
      if (lastCompletedSession) {
        const prevSummary =
          `## Context from previous session\n` +
          `Task: ${lastCompletedSession.task}\n` +
          `Status: ${lastCompletedSession.status}\n` +
          `Completed: ${new Date(lastCompletedSession.completedAt).toISOString()}\n\n` +
          `Output summary:\n${lastCompletedSession.stdout.slice(0, 2000)}` +
          (lastCompletedSession.stdout.length > 2000 ? '\n...[truncated]' : '') +
          `\n\n---\n\n## New task\n${task}`;
        effectiveTask = prevSummary;
      }

      const baseArgs = ['-p', effectiveTask, '--no-ask-user', '--yolo',
        '--agent=delegate-browser',
        `--share=${sessionShareFile}`];
      const spawnArgs = copilotInfo.ghMode ? ['copilot', ...baseArgs] : baseArgs;

      // Append session start marker to the global log (history is preserved across sessions)
      try {
        fs.appendFileSync(GLOBAL_LOG_FILE,
          `\n${'═'.repeat(60)}\n` +
          `SESSION STARTED  ${new Date().toISOString()}\n` +
          `Task: ${task}\n` +
          `${'═'.repeat(60)}\n\n`);
      } catch (_) { /* non-fatal */ }

      const child = spawn(copilotInfo.path, spawnArgs, { cwd, env, stdio: 'pipe' });
      activeSession = { child, task, startedAt: Date.now(), stdout: '', stderr: '' };

      broadcastFn?.({ type: 'copilot.session.start', task: truncatedTask, timestamp: Date.now() });

      let killed = false;
      // Track whether the sessionEnd hook already injected the result
      let hookDelivered = false;
      export_setHookDelivered = (v: boolean) => { hookDelivered = v; };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (activeSession) activeSession.stdout += text;
        try { fs.appendFileSync(GLOBAL_LOG_FILE, text); } catch (_) { /* non-fatal */ }
        broadcastFn?.({ type: 'copilot.stdout', output: text, timestamp: Date.now() });
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (activeSession) activeSession.stderr += text;
        try { fs.appendFileSync(GLOBAL_LOG_FILE, `[stderr] ${text}`); } catch (_) { /* non-fatal */ }
        broadcastFn?.({ type: 'copilot.stderr', output: text, timestamp: Date.now() });
      });

      const timer = setTimeout(() => {
        killed = true;
        try { fs.appendFileSync(GLOBAL_LOG_FILE, `\n[timeout] Sending SIGTERM (${timeoutMs / 60000} min limit reached)...\n`); } catch (_) { /* non-fatal */ }
        child.kill('SIGTERM');
        // Escalate to SIGKILL if the process doesn't exit within the grace period
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
            fs.appendFileSync(GLOBAL_LOG_FILE, '[timeout] SIGTERM ignored — sent SIGKILL\n');
          } catch (_) { /* already exited */ }
        }, sigkillGraceMs);
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        const output = activeSession?.stdout?.trim() || '';
        activeSession = null;
        export_setHookDelivered = null;
        broadcastFn?.({ type: 'copilot.session.end', status: 'error', timestamp: Date.now() });
        console.error(`[copilot-dispatch] Process error: ${err.message}`);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        let sessionStdout = activeSession?.stdout?.trim() || '';
        const sessionStderr = activeSession?.stderr?.trim() || '';
        const sessionTask = activeSession?.task || task;

        const status = killed ? 'timeout' : code !== 0 ? 'error' : 'completed';

        // If stdout is sparse, supplement with the --share transcript
        if (!sessionStdout || sessionStdout.length < 100) {
          try {
            const shareContent = fs.readFileSync(sessionShareFile, 'utf-8').trim();
            if (shareContent) {
              sessionStdout = sessionStdout
                ? `${sessionStdout}\n\n--- Full transcript ---\n${shareContent}`
                : shareContent;
            }
          } catch (_) { /* share file may not exist if session crashed early */ }
        }

        // Preserve output for copilot_status
        lastCompletedSession = {
          task: sessionTask,
          status,
          stdout: sessionStdout,
          stderr: sessionStderr,
          completedAt: Date.now(),
        };

        activeSession = null;
        export_setHookDelivered = null;
        broadcastFn?.({ type: 'copilot.session.end', status, timestamp: Date.now() });
        console.log(`[copilot-dispatch] Process closed (status=${status}, code=${code}, hookDelivered=${hookDelivered}, outputLen=${sessionStdout.length}, stderrLen=${sessionStderr.length})`);
        // Append a completion marker to the log so the persistent VNC terminal shows the final status
        try {
          fs.appendFileSync(GLOBAL_LOG_FILE,
            `\n==============================\n` +
            `Session ${status.toUpperCase()} at ${new Date().toISOString()}\n` +
            (sessionStderr ? `\n[stderr]\n${sessionStderr}\n` : '') +
            `==============================\n`);
        } catch (_) { /* non-fatal */ }

        // Commit + push session outputs to remote repo (non-fatal)
        commitAndPushWorkDir(sessionTask);

        // Fallback: if the sessionEnd hook didn't fire (crash, hook misconfigured),
        // inject the result via the fallback callback
        if (!hookDelivered && fallbackInjector) {
          console.log('[copilot-dispatch] Hook did not deliver — using fallback injection');
          fallbackInjector(sessionTask, status, sessionStdout, sessionStderr);
        }
      });

      addBreadcrumb?.('Copilot dispatch async', { pid: child.pid });
      return {
        status: 'dispatched',
        message: `Task dispatched to Copilot CLI agent (pid ${child.pid}). Results will be delivered asynchronously.`,
      };
    } catch (err: any) {
      addBreadcrumb?.('Copilot dispatch unexpected error', {
        error: err?.message,
      });
      return {
        status: 'error',
        output: '',
        error: err?.message || 'Unexpected error in copilot dispatch handler',
      };
    }
  },
};

export const copilotGetResultHandler: FunctionHandler = {
  schema: {
    name: 'copilot_status',
    type: 'function',
    description:
      'Check the status of the Copilot CLI agent — works whether a session is currently running or has already completed. Returns live progress (stdout so far, elapsed time) for a running session, or the full output for a completed/timed-out session.',
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
    // Check for a currently running session first
    if (activeSession) {
      const elapsed = Math.round((Date.now() - activeSession.startedAt) / 1000);
      addBreadcrumb?.('Copilot get result — session in progress', { elapsed });
      return {
        status: 'running',
        task: activeSession.task,
        elapsedSeconds: elapsed,
        stdoutSoFar: activeSession.stdout.trim(),
        stderrSoFar: activeSession.stderr.trim(),
      };
    }

    // Return last completed session
    if (lastCompletedSession) {
      addBreadcrumb?.('Copilot get result — returning completed session', {
        status: lastCompletedSession.status,
        outputLen: lastCompletedSession.stdout.length,
      });
      return {
        status: lastCompletedSession.status,
        task: lastCompletedSession.task,
        output: lastCompletedSession.stdout,
        stderr: lastCompletedSession.stderr || undefined,
        completedAt: new Date(lastCompletedSession.completedAt).toISOString(),
      };
    }

    addBreadcrumb?.('Copilot get result — no session');
    return {
      status: 'none',
      message: 'No copilot session has run yet.',
    };
  },
};
