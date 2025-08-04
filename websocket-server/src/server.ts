import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";
import { handleCallConnection, handleFrontendConnection, handleChatConnection, handleTextChatMessage } from "./sessionManager";
import functions from "./functionHandlers";
import { openReplyWindow, setNumbers } from './smsState';
import { getLogs } from "./logBuffer";

dotenv.config();

const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
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

  setNumbers({ userFrom: from, twilioTo: to });
  openReplyWindow();

  // Route through the unified, existing chat pipeline (no duplicates)
  // Use the same session as chat (single-threaded assumption)
  await handleTextChatMessage(messageText, chatClients, logsClients);

  // Respond immediately to Twilio
  res.status(200).end();
});

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({ publicUrl: PUBLIC_URL });
});

app.all("/twiml", (req, res) => {
  const wsUrl = new URL(PUBLIC_URL);
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
    handleCallConnection(ws, OPENAI_API_KEY);
    ws.on("close", () => {
      if (session && session.twilioConn === ws) {
        session.twilioConn = undefined;
      }
    });
  } else if (type === "logs") {
    logsClients.add(ws);
    handleFrontendConnection(ws, logsClients);
    ws.on("close", () => logsClients.delete(ws));
  } else if (type === "chat") {
    chatClients.add(ws);
    handleChatConnection(ws, OPENAI_API_KEY, chatClients, logsClients);
    ws.on("close", () => chatClients.delete(ws));
  } else {
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
