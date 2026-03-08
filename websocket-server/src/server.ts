import express from 'express';
import dotenv from "dotenv";
import http from "http";
import { join } from "path";
import { existsSync } from "fs";
import cors from "cors";
import { startEmailPolling } from './emailPoller';
import { attachWebSockets } from './ws/attach';
import { registerTwilioRoutes } from './server/routes/twilio';
import { registerThoughtflowRoutes } from './server/routes/thoughtflow';
import { registerCatalogRoutes } from './server/routes/catalog';
import { registerConversationRoutes } from './server/routes/conversations';
import { registerLogsRoutes } from './server/routes/logs';
import { registerSessionRoutes } from './server/routes/session';
import { registerAdaptationsRoutes } from './server/routes/adaptations';
import { registerMcpConfigRoutes } from './server/routes/mcpConfig';
import { registerCanvasRoutes } from './server/routes/canvas';
import { registerDeepgramRoutes } from './server/routes/deepgram';
import { registerVoiceMessageRoutes } from './server/routes/voiceMessage';
import { registerVoiceDefaultsRoutes } from './server/routes/voiceDefaults';
import { registerOpenAiSessionRoute } from './server/routes/openaiSession';
import { getConfig } from './server/config/env';
import { registerHealthRoutes, setReady } from './server/routes/health';
import { chatClients, logsClients } from './ws/clients';
import { finalizeOpenSessionsOnStartup } from './server/startup/finalize';
import { initToolsAndRegistry } from './server/startup/init';
import { writeLatestStartupResults } from './server/startup/note';
import { reloadAdaptations } from './adaptations';

// Ensure we load the env file from this package even if process is started from repo root
dotenv.config({ path: join(__dirname, '../.env') });

const cfg = getConfig();
const PORT = cfg.port;
const EFFECTIVE_PUBLIC_URL = cfg.effectivePublicUrl;
const OPENAI_API_KEY = cfg.openaiApiKey;
const SESSION_HISTORY_LIMIT = cfg.sessionHistoryLimit;

// Finalize any sessions that were left open (no session.ended) across restarts handled by startup module

const app = express();
app.use(cors({ origin: true }));
app.options('*', cors({ origin: true }));

// Serve the vanilla JS client (index.html) at higher priority than the Next.js export.
// This overrides the root URL while letting Next.js pages (/settings, /voice, etc.) still work.
const vanillaClientDir = join(__dirname, '../client');
if (existsSync(vanillaClientDir)) {
  app.use(express.static(vanillaClientDir, { extensions: ['html'] }));
}

// Serve the static Next.js export.
// Production (dist/): files are at ../webapp-out (copied by CI build into the artifact).
// Dev (src/ via ts-node): fall back to ../../webapp/out (the Next.js out dir at repo root).
const prodClientDir = join(__dirname, '../webapp-out');
const devClientDir = join(__dirname, '../../webapp/out');
const clientDir = existsSync(prodClientDir) ? prodClientDir : devClientDir;
app.use(express.static(clientDir, { extensions: ['html'] }));
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
    toolsReady = true;
    await writeLatestStartupResultsIfReady();
  } catch (e: any) {
    console.warn('[startup] initToolsAndRegistry failed:', e?.message || e);
  }
})();

// Start polling for incoming emails
startEmailPolling(chatClients, logsClients);

app.use(express.urlencoded({ extended: false }));
// Enable JSON body parsing for API endpoints
app.use(express.json());

// Health endpoints
registerHealthRoutes(app);

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

// Canvas route
registerCanvasRoutes(app);

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

// OpenAI Realtime session token proxy
registerOpenAiSessionRoute(app);

// Access token handled in Twilio routes

// No callClients Set for call/voice; use single session.twilioConn

attachWebSockets(server, {
  chatClients,
  logsClients,
  openAIApiKey: OPENAI_API_KEY,
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  serverListening = true;
  // Finalize any open sessions at startup for consistency
  finalizeOpenSessionsOnStartup();
  // If tools are already ready, this will write immediately
  void writeLatestStartupResultsIfReady();
  // Update readiness
  if (toolsReady) setReady(true);
});
