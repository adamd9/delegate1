import { RawData, WebSocket } from "ws";

// Mirror of the Session shape used by the current sessionManager
export type ConversationItem =
  | {
      type: 'user' | 'assistant';
      content: string;
      timestamp: number;
      channel: 'voice' | 'text' | 'sms';
      supervisor?: boolean;
    }
  | {
      type: 'canvas';
      content: string; // URL to stored canvas
      title?: string;
      timestamp: number;
      id: string;
    };

export interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  chatConn?: WebSocket;
  modelConn?: WebSocket; // Raw WebSocket for voice
  textModelConn?: WebSocket; // OpenAI SDK WebSocket for text
  openaiClient?: any; // typed in channel modules
  streamSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  conversationHistory?: ConversationItem[];
  previousResponseId?: string; // For Responses API conversation tracking
  // Minimal in-flight chat request tracking
  currentRequest?: {
    id: string;
    channel: 'voice' | 'text' | 'sms';
    canceled?: boolean;
    startedAt: number;
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
  session.saved_config = undefined;
}
