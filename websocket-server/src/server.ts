import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";
import { establishCallSocket } from "./session/call";
import { establishLogsSocket } from "./session/logs";
import { establishChatSocket } from "./session/chat";
import { processSmsWebhook } from "./session/sms";
import functions from "./functionHandlers";
import { getLogs } from "./logBuffer";
import { getCanvas } from "./canvasStore";
import { marked } from "marked";

dotenv.config();

const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const EFFECTIVE_PUBLIC_URL = (PUBLIC_URL && PUBLIC_URL.trim()) || `http://localhost:${PORT}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.urlencoded({ extended: false }));

// --- Twilio SMS webhook route ---
app.post('/sms', async (req, res) => {
  const messageText = req.body?.Body ?? '';
  const from = req.body?.From ?? '';
  const to = req.body?.To ?? '';

  // Normalize SMS into the unified session-managed chat flow
  await processSmsWebhook({ messageText, from, to }, chatClients, logsClients);

  // Respond immediately to Twilio
  res.status(200).end();
});

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({ publicUrl: EFFECTIVE_PUBLIC_URL });
});

app.all("/twiml", (req, res) => {
  const wsUrl = new URL(EFFECTIVE_PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  const twimlContent = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  console.debug("TWIML:", twimlContent);
  res.type("text/xml").send(twimlContent);
});

// New endpoint to list available tools (schemas)
app.get("/tools", (req, res) => {
  res.json(functions.map((f) => f.schema));
});

// Endpoint to retrieve latest server logs
app.get("/logs", (req, res) => {
  res.type("text/plain").send(getLogs().join("\n"));
});

// Endpoint to serve stored canvas content as HTML
app.get("/canvas/:id", (req, res) => {
  const data = getCanvas(req.params.id);
  if (!data) {
    res.status(404).send("Not found");
    return;
  }
  const html = marked.parse(data.content);
  res.send(`<!doctype html><html><head><title>${data.title || "Canvas"}</title></head><body>${html}</body></html>`);
});

// Access token endpoint for voice client
app.post("/access-token", (req, res) => {
  try {
    const twilio = require('twilio');
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;
    
    const clientName = req.body.clientName || `voice-client-${Date.now()}`;
    
    // Twilio credentials from environment variables only
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;
    
    // Validate required environment variables
    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      console.error('Missing required Twilio environment variables');
      res.status(500).json({
        error: 'Server configuration error',
        message: 'Missing required Twilio credentials in environment variables'
      });
      return;
    }
    
    // Create Voice Grant
    const voiceGrant = new VoiceGrant({
      incomingAllow: true,
      outgoingApplicationSid: twimlAppSid
    });
    
    // Create access token with AU1 region
    const token = new AccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      { 
        identity: clientName,
        region: 'au1'
      }
    );
    
    token.addGrant(voiceGrant);
    const jwt = token.toJwt();
    
    console.log(`Generated access token for client: ${clientName}`);
    
    res.json({
      token: jwt,
      identity: clientName,
      message: "Access token generated successfully"
    });
    
  } catch (error: any) {
    console.error('Error generating access token:', error);
    res.status(500).json({
      error: "Failed to generate access token",
      message: error?.message || 'Unknown error'
    });
  }
});

import session from "./sessionSingleton";
// No callClients Set for call/voice; use single session.twilioConn
const logsClients = new Set<WebSocket>();
const chatClients = new Set<WebSocket>();
// Make available on globalThis for sessionManager event forwarding
(globalThis as any).logsClients = logsClients;
(globalThis as any).chatClients = chatClients;

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 1) {
    ws.close();
    return;
  }

  const type = parts[0];

  if (type === "call") {
    // Restore old logic: only one active Twilio connection (session.twilioConn)
    if (session && session.twilioConn) {
      try {
        session.twilioConn.close();
      } catch (e) {}
      session.twilioConn = undefined;
    }
    session.twilioConn = ws;
    establishCallSocket(ws, OPENAI_API_KEY);
    ws.on("close", () => {
      if (session && session.twilioConn === ws) {
        session.twilioConn = undefined;
      }
    });
  } else if (type === "logs") {
    // Observability stream for the web frontend. The handler replays
    // existing conversation history and forwards realtime events.
    logsClients.add(ws);
    establishLogsSocket(ws, logsClients);
    ws.on("close", () => logsClients.delete(ws));
  } else if (type === "chat") {
    chatClients.add(ws);
    establishChatSocket(ws, OPENAI_API_KEY, chatClients, logsClients);
    ws.on("close", () => chatClients.delete(ws));
  } else {
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
