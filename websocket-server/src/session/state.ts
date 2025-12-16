import { RawData, WebSocket } from "ws";
import { Channel } from '../agentConfigs/context';

// Mirror of the Session shape used by the current sessionManager
export type ConversationItem =
  | {
      type: 'user' | 'assistant';
      content: string;
      timestamp: number;
      channel: Channel;
      supervisor?: boolean;
    }
  | {
      type: 'canvas';
      content: string; // URL to stored canvas
      title?: string;
      timestamp: number;
      id: string;
    }
  | {
      type: 'thoughtflow';
      session_id: string;
      json_path: string;
      d2_path: string;
      url_json: string;
      url_d2: string;
      url_d2_raw: string;
      url_d2_viewer: string;
      timestamp: number;
    };

export interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  chatConn?: WebSocket;
  modelConn?: WebSocket; // Raw WebSocket for voice
  textModelConn?: WebSocket; // OpenAI SDK WebSocket for text
  openaiClient?: any; // typed in channel modules
  voiceTuning?: {
    mode: 'normal' | 'noisy';
    turnDetection?: {
      type?: 'server_vad' | 'semantic_vad' | 'none';
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
      [key: string]: any;
    };
    bargeInGraceMs?: number;
    updatedAtMs?: number;
  };
  streamSid?: string;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  conversationHistory?: ConversationItem[];
  previousResponseId?: string; // For Responses API conversation tracking
  // Sticky conversation tracking for web chat: reuse an open conversation until explicitly finalized
  currentConversationId?: string;
  // Track the most recent assistant step to link subsequent user turns in ThoughtFlow
  lastAssistantStepId?: string;
  // Track the most recent user step to link assistant responses in ThoughtFlow
  lastUserStepId?: string;
  waitingForTool?: boolean;
  // Minimal in-flight chat request tracking
  currentRequest?: {
    id: string;
    channel: Channel;
    canceled?: boolean;
    startedAt: number;
  };
  // ThoughtFlow session tracking (v1 file-based persistence)
  thoughtflow?: {
    sessionId?: string;
    startedAt?: number;
    jsonlPath?: string;
  };
}

// Singleton session state
export let session: Session = {};

export function parseMessage(data: RawData): any {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

export function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));
}

export function isOpen(ws?: WebSocket): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function cleanupConnection(ws?: WebSocket) {
  if (isOpen(ws)) ws.close();
}

export function closeModel() {
  cleanupConnection(session.modelConn);
  session.modelConn = undefined;
  if (!session.twilioConn && !session.frontendConn) session = {};
}

export function closeAllConnections() {
  if (session.twilioConn) {
    session.twilioConn.close();
    session.twilioConn = undefined;
  }
  if (session.modelConn) {
    session.modelConn.close();
    session.modelConn = undefined;
  }
  if (session.frontendConn) {
    session.frontendConn.close();
    session.frontendConn = undefined;
  }
  session.streamSid = undefined;
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.latestMediaTimestamp = undefined;
}
