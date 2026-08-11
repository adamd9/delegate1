import express from 'express';
import dotenv from "dotenv";
import http from "http";
import session from 'express-session';
import { randomBytes } from 'crypto';
import { join } from "path";
import cors from "cors";
import { startEmailPolling, reinitEmailPolling } from './emailPoller';
import { attachWebSockets } from './ws/attach';
import { registerTwilioRoutes } from './server/routes/twilio';
import { registerThoughtflowRoutes } from './server/routes/thoughtflow';
import { registerCatalogRoutes } from './server/routes/catalog';
import { registerConversationRoutes } from './server/routes/conversations';
import { registerLogsRoutes } from './server/routes/logs';
import { registerSessionRoutes } from './server/routes/session';
import { registerAdaptationsRoutes } from './server/routes/adaptations';
import { registerMcpConfigRoutes } from './server/routes/mcpConfig';
import { registerNotesRoutes } from './server/routes/notes';
import { registerDeepgramRoutes } from './server/routes/deepgram';
import { registerVoiceMessageRoutes } from './server/routes/voiceMessage';
import { registerVoiceDefaultsRoutes } from './server/routes/voiceDefaults';
import { registerMemoryConfigRoutes } from './server/routes/memoryConfig';
import { registerMemoriesRoutes } from './server/routes/memories';
import { registerConfigRoutes } from './server/routes/config';
import { registerAgentPromptDefaultsRoute } from './server/routes/agentPrompts';
import { registerSetupRoutes } from './server/routes/setup';
import { registerOpenAiSessionRoute } from './server/routes/openaiSession';
import { registerCopilotRoutes } from './server/routes/copilot';
import { registerCopilotTasksRoutes } from './server/routes/copilotTasks';
import { registerAgentMessageRoutes } from './server/routes/agentMessage';
import { registerVncRoutes } from './server/routes/vnc';
import { registerDevWalkieRoutes } from './server/routes/devWalkie';
import { registerDevWalkieVoiceRoutes } from './server/routes/devWalkieVoice';
import { getConfig } from './server/config/env';
import { registerHealthRoutes, setReady } from './server/routes/health';
import { registerBuildInfoRoutes } from './server/routes/buildInfo';
import { chatClients, logsClients } from './ws/clients';
import { finalizeOpenSessionsOnStartup } from './server/startup/finalize';
import { initToolsAndRegistry } from './server/startup/init';
import { writeLatestStartupResults } from './server/startup/note';
import { reloadAdaptations } from './adaptations';
import { startBrowserInfra, stopBrowserInfra, reinitBrowserInfra } from './browser';
import { registerMcpServerRoutes } from './mcp/server';
import { startInnerContextPlane, stopInnerContextPlane } from './innerContext';
import { configService } from './config';
import { registerReinit } from './reinit/registry';
import { getDb } from './db/sqlite';
import { installGuard, requireAuth } from './server/middleware/auth';
import { registerAuthRoutes } from './server/routes/auth';

// Ensure we load the env file from this package even if process is started from repo root
dotenv.config({ path: join(__dirname, '../.env') });

const cfg = getConfig();
const PORT = cfg.port;
const EFFECTIVE_PUBLIC_URL = cfg.effectivePublicUrl;
const OPENAI_API_KEY = cfg.openaiApiKey;
const SESSION_HISTORY_LIMIT = cfg.sessionHistoryLimit;

// Finalize any sessions that were left open (no session.ended) across restarts handled by startup module

const BetterSqlite3SessionStore = require('better-sqlite3-session-store');
const SqliteStore = BetterSqlite3SessionStore(session);
const SESSION_TABLE_NAME = 'http_sessions';

function createSessionStoreClient(database: ReturnType<typeof getDb>) {
  const rewriteSql = (sql: string) => sql.replace(/\bsessions\b/g, SESSION_TABLE_NAME);
  return {
    exec(sql: string) {
      return database.exec(rewriteSql(sql));
    },
    prepare(sql: string) {
      return database.prepare(rewriteSql(sql));
    },
  };
}

function getSessionSecret(): string {
  const existingSecret = configService.get('_session_secret');
  if (existingSecret) {
    return existingSecret;
  }

  const generatedSecret = randomBytes(32).toString('hex');
  configService.set('_session_secret', generatedSecret, false);
  return generatedSecret;
}

function allowPublicWithoutAuth(pathname: string): boolean {
  return pathname === '/login'
    || pathname === '/login.html'
    || pathname === '/install'
    || pathname === '/install.html'
    || pathname === '/logout'
    || pathname === '/health'
    || pathname === '/ready'
    || pathname === '/build-info.json'
    || pathname === '/public-url'
    || pathname === '/twiml'
    || pathname === '/sms'
    || pathname === '/auth/status'
    || pathname === '/api/install'
    || pathname === '/api/copilot/callback'
    || pathname.startsWith('/_dev/walkie');
}

const app = express();
app.use(cors({ origin: true }));
app.options('*', cors({ origin: true }));

const vanillaClientDir = join(__dirname, '../client');

const server = http.createServer(app);

// Track readiness across async startup steps so we can persist a startup note
let toolsReady = false;
let serverListening = false;
let startupNoteWritten = false;

async function writeLatestStartupResultsIfReady() {
  if (startupNoteWritten) return;
  if (!(toolsReady && serverListening)) return;
  startupNoteWritten = true;
  try { setReady(true); } catch {}
  try { await writeLatestStartupResults(); } catch (err) {
    console.warn('[startup] Failed to write latest startup results note:', (err as any)?.message || err);
  }
}

// Kick off discovery + tools registry (non-blocking)
(async () => {
  try {
    await initToolsAndRegistry();
    console.log('[startup] Tools registry initialized');
    // Ensure adaptations edits file exists and skeleton is merged
    try {
      const r = await reloadAdaptations();
      console.log('[startup] Adaptations initialized (version:', r.version, ')');
    } catch (e: any) {
      console.warn('[startup] reloadAdaptations failed:', e?.message || e);
    }
    // Start browser infrastructure (Xvfb/VNC in Docker, directories in local dev)
    const browserResult = await startBrowserInfra();
    if (!browserResult.ok) {
      console.error(`[server] browser infrastructure failed: ${browserResult.error}`);
    } else if (browserResult.resolvedRepo) {
      // Persist the resolved workspace repo back into config so the settings UI
      // shows what scaffoldWorkDir actually picked (auto-created on first run
      // OR discovered from a previous boot). Without this the field stays
      // blank in the UI even though the system is happily using the repo.
      const current = (configService.getRaw('COPILOT_REMOTE_REPO') || '').trim();
      if (current !== browserResult.resolvedRepo) {
        configService.set('COPILOT_REMOTE_REPO', browserResult.resolvedRepo, false);
        console.log(`[startup] Persisted COPILOT_REMOTE_REPO = ${browserResult.resolvedRepo}${browserResult.autoCreated ? ' (auto-created)' : ' (discovered)'}`);
      }
    }

    toolsReady = true;
    await writeLatestStartupResultsIfReady();
  } catch (e: any) {
    console.warn('[startup] initToolsAndRegistry failed:', e?.message || e);
  }
})();

// Start polling for incoming emails
startEmailPolling(chatClients, logsClients);

// ─── Reinit registrations ─────────────────────────────────────────────
// Each subsystem that bootstraps at startup registers a "reinit me" hook
// for the config keys it cares about. When those keys change in the
// settings UI, the config PUT route invokes the appropriate hook.

registerReinit(
  'Copilot + Browser Control',
  ['BROWSER_ENABLED', 'COPILOT_GITHUB_TOKEN', 'COPILOT_REMOTE_REPO'],
  async () => {
    const result = await reinitBrowserInfra();
    if (!result.ok) {
      return { service: 'Copilot + Browser Control', status: 'error', message: result.error || 'Failed to start browser infrastructure' };
    }
    if (result.disabled) {
      return { service: 'Copilot + Browser Control', status: 'ok', message: 'Browser agent disabled — infrastructure stopped' };
    }
    const updatedKeys: Record<string, string> = {};
    if (result.resolvedRepo) {
      // Always write back the resolved repo so the settings UI reflects what
      // scaffoldWorkDir actually picked — covers both the auto-create path and
      // the "discovered an existing remote" path (e.g. after a fresh deploy
      // where the GitHub repo persists but the config row was never set).
      const current = (configService.getRaw('COPILOT_REMOTE_REPO') || '').trim();
      if (current !== result.resolvedRepo) {
        updatedKeys.COPILOT_REMOTE_REPO = result.resolvedRepo;
      }
    }
    const repoNote = result.resolvedRepo
      ? ` Workspace repo: ${result.resolvedRepo}${result.autoCreated ? ' (auto-created)' : ''}.`
      : '';
    return {
      service: 'Copilot + Browser Control',
      status: 'ok',
      message: `Browser infrastructure restarted.${repoNote}`,
      updatedKeys: Object.keys(updatedKeys).length ? updatedKeys : undefined,
    };
  }
);

registerReinit(
  'Email',
  ['EMAIL_IMAP_HOST', 'EMAIL_IMAP_PORT', 'EMAIL_IMAP_USER', 'EMAIL_IMAP_PASS', 'EMAIL_IMAP_PASSWORD', 'EMAIL_IMAP_TLS', 'EMAIL_SMTP_USER', 'EMAIL_SMTP_PASS', 'EMAIL_DEFAULT_FROM', 'EMAIL_RECEIVING_FILTER_ENABLED'],
  async () => {
    const result = reinitEmailPolling();
    return {
      service: 'Email',
      status: result.ok ? 'ok' : 'error',
      message: result.message,
    };
  }
);

// Agent prompt edits are read fresh on every model call via the getter on
// baseAgentConfig.instructions, so no actual reinit work is needed. Register
// a no-op handler purely so the settings UI shows a confirmation toast and
// users get clear feedback that the new prompts will apply on the next turn.
registerReinit(
  'Agent prompts',
  ['AGENT_PERSONALITY', 'AGENT_INSTRUCTIONS'],
  async (changedKeys) => {
    const which = changedKeys
      .map((k) => (k === 'AGENT_PERSONALITY' ? 'personality' : 'instructions'))
      .join(' and ');
    return {
      service: 'Agent prompts',
      status: 'ok',
      message: `Updated ${which}. Applies on the next model turn.`,
    };
  }
);

app.use(express.urlencoded({ extended: false }));
// Enable JSON body parsing for API endpoints
app.use(express.json());
const sessionMiddleware = session({
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  store: new SqliteStore({ client: createSessionStoreClient(getDb()) }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

registerAuthRoutes(app);
app.use(installGuard);
app.use((req, res, next) => {
  if (allowPublicWithoutAuth(req.path)) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

// Health endpoints
registerHealthRoutes(app);

// Build info endpoint
registerBuildInfoRoutes(app);

// Thoughtflow artifacts and debug endpoints
registerThoughtflowRoutes(app);

// Twilio routes: /public-url, /twiml, /access-token, /sms
registerTwilioRoutes(app, { effectivePublicUrl: EFFECTIVE_PUBLIC_URL, chatClients, logsClients });

// Catalog/agents/tools routes
registerCatalogRoutes(app);

// Logs route
registerLogsRoutes(app);

// Conversation routes
registerConversationRoutes(app, { defaultLimit: SESSION_HISTORY_LIMIT });

// (removed /sms/debug temporary diagnostics)

// Notes route (public note rendering)
registerNotesRoutes(app);

// Deepgram auth routes
registerDeepgramRoutes(app);
// Voice message REST endpoint
registerVoiceMessageRoutes(app);

// Session control route
registerSessionRoutes(app, { chatClients, logsClients });

// Adaptations management API
registerAdaptationsRoutes(app);
// MCP config management API
registerMcpConfigRoutes(app);
// Voice defaults management API
registerVoiceDefaultsRoutes(app);
// Memory config management API
registerMemoryConfigRoutes(app);
// Memory browsing/deletion API
registerMemoriesRoutes(app);
// App config management API
registerConfigRoutes(app);
registerAgentPromptDefaultsRoute(app);
registerSetupRoutes(app);

// OpenAI Realtime session token proxy
registerOpenAiSessionRoute(app);

// Copilot CLI hook callback routes
registerCopilotRoutes(app);
// Copilot Tasks (durable tasks UI + API)
registerCopilotTasksRoutes(app);

// External agent injection routes
registerMcpServerRoutes(app);
registerAgentMessageRoutes(app);

// VNC web viewer routes (noVNC static files + auth endpoint)
registerVncRoutes(app);

// TEMPORARY: ZeppOS walkie-talkie dev/debug routes (/_dev/walkie/*)
registerDevWalkieRoutes(app);
registerDevWalkieVoiceRoutes(app);

// Pretty URL for task detail: /tasks/<id> → client/task.html (resolved client-side from path)
app.get('/tasks/:id', (_req, res) => {
  res.sendFile(join(vanillaClientDir, 'task.html'));
});

// Serve the vanilla JS client (after all API routes so they take priority)
app.use(express.static(vanillaClientDir, { extensions: ['html'] }));

// Access token handled in Twilio routes

// No callClients Set for call/voice; use single session.twilioConn

attachWebSockets(server, {
  chatClients,
  logsClients,
  openAIApiKey: OPENAI_API_KEY,
  sessionMiddleware,
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  serverListening = true;
  // Finalize any open sessions at startup for consistency
  finalizeOpenSessionsOnStartup();
  // Reset copilot tasks that were left in 'running' across a restart
  try {
    const { reconcileOnStartup } = require('./copilot/taskRunner');
    reconcileOnStartup();
  } catch (err: any) {
    console.warn('[server] copilot tasks reconcile failed:', err?.message || err);
  }
  startInnerContextPlane();
  // If tools are already ready, this will write immediately
  void writeLatestStartupResultsIfReady();
  // Update readiness
  if (toolsReady) setReady(true);
});

function gracefulShutdown(signal: string) {
  console.log(`[server] ${signal} received — shutting down`);
  stopInnerContextPlane();
  stopBrowserInfra();
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
