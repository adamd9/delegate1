import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Config: resolve paths based on Docker vs local-dev environment
// ---------------------------------------------------------------------------

const isDocker = (): boolean =>
  process.env.DOCKER === 'true' || fs.existsSync('/.dockerenv');

const RUNTIME_DATA_DIR = process.env.RUNTIME_DATA_DIR;

const _runtimeBase: string = RUNTIME_DATA_DIR
  ? RUNTIME_DATA_DIR
  : isDocker()
    ? '/app/runtime-data'
    : path.join(__dirname, '..', '..', 'runtime-data');

export const BROWSER_PROFILE_DIR: string = path.join(_runtimeBase, 'browser-profile');
export const COPILOT_WORK_DIR: string    = path.join(_runtimeBase, 'copilot-workdir');
export const COPILOT_HOME_DIR: string    = path.join(_runtimeBase, 'copilot-home');

/** Append-only log file shared by all copilot sessions — tailed by the persistent VNC terminal. */
export const GLOBAL_LOG_FILE = '/tmp/copilot-session.log';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface BrowserStatus {
  enabled: boolean;
  running: boolean;
  dockerMode: boolean;
  vncPort?: number;
  display?: string;
  profileDir: string;
  workDir: string;
}

let xvfbProc: ChildProcess | null = null;
let fluxboxProc: ChildProcess | null = null;
let x11vncProc: ChildProcess | null = null;
let chromiumProc: ChildProcess | null = null;
let xtermLogProc: ChildProcess | null = null;
let running = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectories(): void {
  fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
  fs.mkdirSync(COPILOT_WORK_DIR, { recursive: true });
  fs.mkdirSync(COPILOT_HOME_DIR, { recursive: true });
}

const DEFAULT_REPO_NAME = 'delegate1-copilot-workspace';

/** Use the GitHub API (via token) to get the authenticated user's login. */
function getGitHubUser(token: string): string | null {
  try {
    const result = execSync(
      `curl -s -H "Authorization: token ${token}" https://api.github.com/user`,
      { encoding: 'utf8' }
    );
    const data = JSON.parse(result);
    return data.login || null;
  } catch {
    return null;
  }
}

/** Check if a GitHub repo exists. Returns the clone URL if it does, null otherwise. */
function repoExists(owner: string, name: string, token: string): string | null {
  try {
    const result = execSync(
      `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token ${token}" https://api.github.com/repos/${owner}/${name}`,
      { encoding: 'utf8' }
    );
    if (result.trim() === '200') {
      return `https://github.com/${owner}/${name}.git`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Create a private GitHub repo and return its clone URL. */
function createRepo(name: string, token: string): string | null {
  try {
    const result = execSync(
      `curl -s -X POST -H "Authorization: token ${token}" -H "Content-Type: application/json" ` +
      `https://api.github.com/user/repos -d '{"name":"${name}","private":true,"auto_init":true,"description":"Copilot CLI workspace — auto-managed by Delegate"}'`,
      { encoding: 'utf8' }
    );
    const data = JSON.parse(result);
    if (data.clone_url) {
      console.log(`[browser] created GitHub repo: ${data.clone_url}`);
      return data.clone_url;
    }
    console.warn('[browser] repo creation response missing clone_url:', data.message || data);
    return null;
  } catch (err) {
    console.warn('[browser] failed to create GitHub repo:', err);
    return null;
  }
}

/** Auto-create (or discover) the default remote repo using the token. Returns HTTPS clone URL or undefined. */
function autoCreateRemoteRepo(token: string): string | undefined {
  const user = getGitHubUser(token);
  if (!user) {
    console.warn('[browser] could not determine GitHub user from token — skipping remote repo setup');
    return undefined;
  }

  // Check if the default repo already exists
  const existing = repoExists(user, DEFAULT_REPO_NAME, token);
  if (existing) {
    console.log(`[browser] found existing remote repo: ${existing}`);
    return existing;
  }

  // Create it
  const created = createRepo(DEFAULT_REPO_NAME, token);
  return created || undefined;
}

/** Return an HTTPS URL with the token embedded for auth. */
function authedUrl(remoteUrl: string, token: string): string {
  if (remoteUrl.startsWith('https://')) {
    return remoteUrl.replace('https://', `https://x-access-token:${token}@`);
  }
  return remoteUrl;
}

/**
 * Set up the local working directory from a remote repo.
 * If the local dir has stale content, blow it away and do a fresh clone.
 */
function setupWorkDirFromRemote(remoteUrl: string, token: string): void {
  const gitDir = path.join(COPILOT_WORK_DIR, '.git');
  const cloneUrl = authedUrl(remoteUrl, token);

  // Mark the workdir as safe to avoid "dubious ownership" errors in containers
  try {
    execSync(`git config --global --add safe.directory "${COPILOT_WORK_DIR}"`, { stdio: 'ignore' });
  } catch { /* best-effort */ }

  // If there's already a .git dir, check if origin matches
  if (fs.existsSync(gitDir)) {
    try {
      const currentOrigin = execSync('git remote get-url origin', { cwd: COPILOT_WORK_DIR, encoding: 'utf8' }).trim();
      if (currentOrigin === remoteUrl) {
        // Same remote — just pull latest
        try {
          execSync(
            `git pull "${cloneUrl}" main --rebase --autostash 2>&1 || true`,
            { cwd: COPILOT_WORK_DIR, stdio: 'ignore' }
          );
          console.log(`[browser] pulled latest from ${remoteUrl}`);
        } catch {
          console.warn('[browser] pull failed (non-fatal) — continuing with local state');
        }
        return;
      }
    } catch {
      // No origin or corrupt git dir — fall through to fresh clone
    }
  }

  // Fresh clone: remove existing content and clone
  console.log(`[browser] setting up working directory from ${remoteUrl}`);
  try {
    // Remove everything except the parent dir
    const entries = fs.readdirSync(COPILOT_WORK_DIR);
    for (const entry of entries) {
      fs.rmSync(path.join(COPILOT_WORK_DIR, entry), { recursive: true, force: true });
    }

    // Clone into the work dir (use authed URL, store clean URL as origin)
    const parentDir = path.dirname(COPILOT_WORK_DIR);
    const dirName = path.basename(COPILOT_WORK_DIR);
    execSync(
      `git clone "${cloneUrl}" "${dirName}" 2>&1`,
      { cwd: parentDir, encoding: 'utf8' }
    );
    // Replace the authed origin with the clean URL (don't persist token in .git/config)
    try {
      execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: COPILOT_WORK_DIR, encoding: 'utf8' });
    } catch (setUrlErr: any) {
      console.warn('[browser] set-url failed (non-fatal):', setUrlErr.stderr || setUrlErr.message);
    }
    console.log(`[browser] cloned ${remoteUrl} into ${COPILOT_WORK_DIR}`);
  } catch (err: any) {
    console.warn('[browser] clone failed:', err.message || err);
    // Fallback: init locally and add remote
    try {
      if (!fs.existsSync(gitDir)) {
        execSync('git init', { cwd: COPILOT_WORK_DIR, stdio: 'ignore' });
        execSync('git commit --allow-empty -m "init copilot workdir"', { cwd: COPILOT_WORK_DIR, stdio: 'ignore' });
      }
      execSync(`git remote add origin "${remoteUrl}" 2>/dev/null || git remote set-url origin "${remoteUrl}"`, {
        cwd: COPILOT_WORK_DIR, stdio: 'ignore'
      });
      console.log('[browser] fallback: initialized local repo with remote configured');
    } catch (fallbackErr) {
      console.warn('[browser] fallback git setup failed:', fallbackErr);
    }
  }
}

function scaffoldWorkDir(): void {
  // Copilot CLI discovers agents from $COPILOT_HOME/agents/ (user-global path)
  const agentDestDir = path.join(COPILOT_HOME_DIR, 'agents');
  const destFile = path.join(agentDestDir, 'delegate-browser.agent.md');

  // Resolve source: dist/copilot-agent/ (prod) or src/copilot-agent/ (dev)
  const candidates = [
    path.join(__dirname, '..', 'copilot-agent', 'delegate-browser.agent.md'),
    path.join(__dirname, '..', '..', 'src', 'copilot-agent', 'delegate-browser.agent.md'),
  ];

  const srcFile = candidates.find((p) => fs.existsSync(p));
  if (!srcFile) {
    console.warn('[browser] agent definition not found — skipping workdir scaffold');
    return;
  }

  fs.mkdirSync(agentDestDir, { recursive: true });
  fs.copyFileSync(srcFile, destFile);
  console.log(`[browser] agent definition installed to ${destFile}`);

  // ---- Git repository setup ----
  // Strategy: if COPILOT_REMOTE_REPO is set, use it. Otherwise auto-create one.
  // Always ensure local workdir is a clean clone of the remote.
  const token = process.env.COPILOT_GITHUB_TOKEN;
  let remoteRepo = process.env.COPILOT_REMOTE_REPO;

  if (token && !remoteRepo) {
    // Auto-create a default repo if none specified
    remoteRepo = autoCreateRemoteRepo(token);
  }

  if (remoteRepo && token) {
    setupWorkDirFromRemote(remoteRepo, token);
  } else {
    // No remote — just ensure local git init for copilot CLI
    const gitDir = path.join(COPILOT_WORK_DIR, '.git');
    if (!fs.existsSync(gitDir)) {
      try {
        execSync('git init', { cwd: COPILOT_WORK_DIR, stdio: 'ignore' });
        execSync('git commit --allow-empty -m "init copilot workdir"', { cwd: COPILOT_WORK_DIR, stdio: 'ignore' });
        console.log('[browser] initialized local-only git repo in copilot working directory');
      } catch (err) {
        console.warn('[browser] failed to git init copilot working dir:', err);
      }
    }
  }

  // Scaffold Copilot CLI hooks (overwrite every run to stay up to date)
  const hooksDir = path.join(COPILOT_WORK_DIR, '.github', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hooksJson = {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: 'command',
          bash: './.github/hooks/callback.sh',
          env: { HOOK_TYPE: 'sessionEnd' },
          timeoutSec: 15,
        },
      ],
      postToolUse: [
        {
          type: 'command',
          bash: './.github/hooks/callback.sh',
          env: { HOOK_TYPE: 'postToolUse' },
          timeoutSec: 10,
        },
      ],
      errorOccurred: [
        {
          type: 'command',
          bash: './.github/hooks/callback.sh',
          env: { HOOK_TYPE: 'errorOccurred' },
          timeoutSec: 10,
        },
      ],
    },
  };
  fs.writeFileSync(path.join(hooksDir, 'hooks.json'), JSON.stringify(hooksJson, null, 2));

  const callbackSh = `#!/bin/bash
# Copilot CLI hook callback — sends hook payload to the agent's HTTP server
# HOOK_TYPE and AGENT_CALLBACK_URL are set via environment variables

INPUT=$(cat)

if [ -z "$AGENT_CALLBACK_URL" ]; then
  echo "[copilot-hook] AGENT_CALLBACK_URL not set, skipping callback" >&2
  exit 0
fi

# POST the hook payload to the agent callback endpoint
curl -s -X POST "\${AGENT_CALLBACK_URL}/api/copilot/callback" \\
  -H "Content-Type: application/json" \\
  -d "{\\"hookType\\": \\"\${HOOK_TYPE}\\", \\"payload\\": \${INPUT}}" \\
  --connect-timeout 5 \\
  --max-time 10 \\
  2>/dev/null || echo "[copilot-hook] callback failed (non-fatal)" >&2

exit 0
`;
  const callbackPath = path.join(hooksDir, 'callback.sh');
  fs.writeFileSync(callbackPath, callbackSh);
  fs.chmodSync(callbackPath, 0o755);

  console.log('[browser] scaffolded copilot hooks in', hooksDir);

  // Install playwright-cli skills so Copilot CLI knows how to drive the browser
  // This creates .github/copilot/skills/playwright-cli/SKILL.md (and siblings) in the workdir.
  // Overwrite every run to ensure skills stay up to date.
  try {
    execSync('playwright-cli install --skills', { cwd: COPILOT_WORK_DIR, stdio: 'ignore' });
    console.log('[browser] playwright-cli skills installed in workdir');
  } catch (err: any) {
    // Non-fatal — copilot can still run; it just won't have the packaged skill reference
    console.warn('[browser] playwright-cli install --skills failed (non-fatal):', err.message || err);
  }
}

function setupCopilotHome(): void {
  const configPath = path.join(COPILOT_HOME_DIR, 'config.json');
  const config = {
    trusted_folders: [COPILOT_WORK_DIR],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  process.env.COPILOT_HOME = COPILOT_HOME_DIR;
  console.log(`[browser] Copilot home configured — ${configPath} (trusted: ${COPILOT_WORK_DIR})`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Commit all changes in the copilot working directory and push to remote (if configured).
 * Called after each copilot session ends. Non-fatal — errors are logged but don't propagate.
 */
export type GitSyncResult = {
  status: 'no_changes' | 'committed' | 'pushed' | 'push_failed' | 'commit_failed';
  message: string;
};

export function commitAndPushWorkDir(taskSummary: string): GitSyncResult {
  try {
    // Check for changes
    const status = execSync('git status --porcelain', { cwd: COPILOT_WORK_DIR, encoding: 'utf8' }).trim();
    if (!status) {
      console.log('[browser] no changes to commit after session');
      return { status: 'no_changes', message: 'No changes to commit' };
    }

    // Stage all changes
    execSync('git add -A', { cwd: COPILOT_WORK_DIR, stdio: 'ignore' });

    // Commit with a descriptive message
    const shortTask = taskSummary.length > 72 ? taskSummary.slice(0, 72) + '…' : taskSummary;
    const commitMsg = `session: ${shortTask}`;
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: COPILOT_WORK_DIR, stdio: 'ignore' });
    console.log(`[browser] committed session output: ${commitMsg}`);

    // Push if origin remote is configured
    let remoteUrl: string | null = null;
    try {
      remoteUrl = execSync('git remote get-url origin', { cwd: COPILOT_WORK_DIR, encoding: 'utf8' }).trim();
    } catch {
      // No remote configured
    }

    if (!remoteUrl) {
      return { status: 'committed', message: 'Committed locally (no remote configured)' };
    }

    const token = process.env.COPILOT_GITHUB_TOKEN;
    try {
      const pushUrl = token ? authedUrl(remoteUrl, token) : remoteUrl;
      execSync(
        `git push "${pushUrl}" main 2>&1`,
        { cwd: COPILOT_WORK_DIR, encoding: 'utf8' }
      );
      console.log(`[browser] pushed to ${remoteUrl}`);
      return { status: 'pushed', message: 'Committed and pushed to origin' };
    } catch (pushErr: any) {
      const reason = pushErr.message || String(pushErr);
      console.warn('[browser] push failed (non-fatal):', reason);
      return { status: 'push_failed', message: `Committed locally but push failed: ${reason}` };
    }
  } catch (err: any) {
    const reason = err.message || String(err);
    console.warn('[browser] commit failed (non-fatal):', reason);
    return { status: 'commit_failed', message: `Git commit failed: ${reason}` };
  }
}

function killProc(name: string, proc: ChildProcess | null): void {
  if (!proc || proc.pid == null) return;
  try {
    console.log(`[browser] stopping ${name} (pid ${proc.pid})`);
    process.kill(proc.pid, 'SIGTERM');
  } catch (err) {
    // Process may already be gone — that's fine.
    console.log(`[browser] ${name} already exited or could not be killed`);
  }
}

// ---------------------------------------------------------------------------
// Deferred browser launch
// ---------------------------------------------------------------------------

/**
 * Launch the persistent headed Chromium browser via playwright-cli.
 * Called after startup probe passes so Chromium doesn't starve the health check.
 *
 * IMPORTANT: We must NOT set PLAYWRIGHT_CLI_SESSION in the env here.
 * The startDaemon() code in playwright-core incorrectly passes that env var
 * as --endpoint to the daemon, which treats it as a browser WebSocket endpoint
 * to connect to (not a session name), causing "connect ENOENT delegate".
 * Instead we pass the session name via the -s CLI flag.
 */
function _launchHeadedBrowser(): void {
  try {
    // Write playwright-cli config with Chromium flags required for container environments.
    // --disable-dev-shm-usage: prevents Chrome crashes when /dev/shm is too small (Azure App Service).
    // --no-sandbox:            required when running as root in containers.
    // --disable-gpu:           avoids GPU-related crashes in headless/virtual display environments.
    // --single-process:        reduces memory by merging renderer into the browser process.
    const playwrightConfigDir = path.join(COPILOT_WORK_DIR, '.playwright');
    fs.mkdirSync(playwrightConfigDir, { recursive: true });
    const playwrightConfig = {
      browser: {
        launchOptions: {
          args: [
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-gpu',
            '--single-process',
          ],
        },
      },
    };
    fs.writeFileSync(
      path.join(playwrightConfigDir, 'cli.config.json'),
      JSON.stringify(playwrightConfig, null, 2),
    );

    // Strip PLAYWRIGHT_CLI_SESSION from env to avoid the --endpoint bug
    const { PLAYWRIGHT_CLI_SESSION: _stripped, ...cleanEnv } = process.env;
    const browserEnv: Record<string, string> = {
      ...(cleanEnv as Record<string, string>),
      DISPLAY: ':99',
    };

    chromiumProc = spawn('playwright-cli', [
      '-s=delegate',
      'open', 'about:blank',
      '--persistent',
      '--headed',
      '--browser=chromium',
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: browserEnv,
      cwd: COPILOT_WORK_DIR,
    });

    // Capture output for debugging — playwright-cli open is a short-lived
    // client command that tells the daemon to launch the browser, then exits.
    let stdout = '';
    let stderr = '';
    chromiumProc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    chromiumProc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    chromiumProc.on('exit', (code: number | null) => {
      if (code === 0) {
        console.log(`[browser] playwright-cli open exited successfully`);
        if (stdout.trim()) console.log(`[browser]   stdout: ${stdout.trim()}`);
      } else {
        console.warn(`[browser] playwright-cli open exited with code ${code}`);
        if (stdout.trim()) console.warn(`[browser]   stdout: ${stdout.trim()}`);
        if (stderr.trim()) console.warn(`[browser]   stderr: ${stderr.trim()}`);
      }
    });
    chromiumProc.unref();
    console.log(`[browser] persistent headed browser starting (pid ${chromiumProc.pid}), cwd: ${COPILOT_WORK_DIR}`);
  } catch (err: any) {
    console.warn('[browser] failed to start persistent headed browser:', err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startBrowserInfra(): Promise<{ ok: boolean; error?: string }> {
  if (process.env.BROWSER_ENABLED !== 'true') {
    return { ok: true };
  }

  const docker = isDocker();

  try {
    ensureDirectories();
    console.log(`[browser] directories ready — profile: ${BROWSER_PROFILE_DIR}, work: ${COPILOT_WORK_DIR}`);

    setupCopilotHome();
    scaffoldWorkDir();

    if (!docker) {
      console.log('[browser] local dev mode — skipping display processes');
      running = true;
      return { ok: true };
    }

    // --- Docker mode: start Xvfb, fluxbox, x11vnc ---

    console.log('[browser] Docker mode detected — starting display infrastructure');

    xvfbProc = spawn('Xvfb', [':99', '-screen', '0', '1280x1024x24', '-ac'], {
      detached: false,
      stdio: 'ignore',
    });
    console.log(`[browser] Xvfb started (pid ${xvfbProc.pid})`);

    process.env.DISPLAY = ':99';

    // Give Xvfb a moment to initialise the display
    await delay(500);

    // Write a minimal fluxbox config to enforce 1 workspace
    const fluxboxDir = path.join(process.env.HOME || '/root', '.fluxbox');
    fs.mkdirSync(fluxboxDir, { recursive: true });
    const fluxboxInit = path.join(fluxboxDir, 'init');
    if (!fs.existsSync(fluxboxInit)) {
      fs.writeFileSync(fluxboxInit,
        'session.screen0.workspaces:\t1\n' +
        'session.screen0.workspaceNames:\tmain\n'
      );
    }

    fluxboxProc = spawn('fluxbox', [], {
      detached: false,
      stdio: 'ignore',
      env: { ...process.env, DISPLAY: ':99' },
    });
    console.log(`[browser] fluxbox started (pid ${fluxboxProc.pid})`);

    const vncPassword = process.env.VNC_PASSWORD || 'delegate';
    x11vncProc = spawn(
      'x11vnc',
      ['-display', ':99', '-passwd', vncPassword, '-forever', '-shared', '-rfbport', '5900'],
      { detached: false, stdio: 'ignore' },
    );
    console.log(`[browser] x11vnc started (pid ${x11vncProc.pid})`);

    // Give fluxbox time to initialise the window manager before placing windows
    await delay(1500);

    // Ensure the global log file exists so tail -f starts immediately
    try {
      if (!fs.existsSync(GLOBAL_LOG_FILE)) fs.writeFileSync(GLOBAL_LOG_FILE, '');
    } catch (_) { /* non-fatal */ }

    // --- Persistent terminal (right half: x=822, 58 cols × 52 rows) ---
    xtermLogProc = spawn('xterm', [
      '-title', 'Copilot Log',
      '-fg', 'lime green',
      '-bg', 'black',
      '-fs', '10',
      '-geometry', '58x52+822+0',
      '-e', 'tail', '-f', GLOBAL_LOG_FILE,
    ], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, DISPLAY: ':99' },
    });
    xtermLogProc.unref();
    console.log(`[browser] xterm log started (pid ${xtermLogProc.pid})`);

    // --- Persistent headed browser (left half of VNC) ---
    // Deferred: launch after a short delay so the HTTP server can pass the
    // Azure startup health probe before Chromium consumes resources.
    setTimeout(() => {
      _launchHeadedBrowser();
    }, 10_000);

    running = true;
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[browser] failed to start infrastructure: ${message}`);
    return { ok: false, error: message };
  }
}

export function stopBrowserInfra(): void {
  console.log('[browser] stopping browser infrastructure');
  try {
    killProc('chromium', chromiumProc);
    killProc('xterm-log', xtermLogProc);
    killProc('x11vnc', x11vncProc);
    killProc('fluxbox', fluxboxProc);
    killProc('Xvfb', xvfbProc);

    chromiumProc = null;
    xtermLogProc = null;
    x11vncProc = null;
    fluxboxProc = null;
    xvfbProc = null;
    running = false;

    console.log('[browser] all processes stopped');
  } catch (err) {
    console.error('[browser] error during shutdown', err);
  }
}

export function getBrowserStatus(): BrowserStatus {
  const docker = isDocker();
  const status: BrowserStatus = {
    enabled: process.env.BROWSER_ENABLED === 'true',
    running,
    dockerMode: docker,
    profileDir: BROWSER_PROFILE_DIR,
    workDir: COPILOT_WORK_DIR,
  };

  if (docker && running) {
    status.vncPort = 5900;
    status.display = ':99';
  }

  return status;
}
