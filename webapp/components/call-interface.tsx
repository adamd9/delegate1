"use client";

import React, { useState, useEffect } from "react";
import TopBar from "@/components/top-bar";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Settings, X } from "lucide-react";
import SessionConfigurationPanel from "@/components/session-configuration-panel";
import { EnhancedTranscript } from "@/components/enhanced-transcript";
import CanvasPreviewPanel from "@/components/canvas-preview-panel";

import { Item } from "@/components/types";
import handleRealtimeEvent from "@/lib/handle-realtime-event";
import handleEnhancedRealtimeEvent from "@/lib/handle-enhanced-realtime-event";
import ServiceChecklist from "@/components/phone-number-checklist";
import { useTranscript } from "@/contexts/TranscriptContext";
import { getBackendUrl, getWebSocketUrl } from "@/lib/get-backend-url";



import statusSingletonChecker from "../lib/statusSingletonChecker";

const CallInterface = () => {
  // Use singleton checker for setup checklist
  const [checklistResult, setChecklistResult] = useState<any>(null);
  const [allConfigsReady, setAllConfigsReady] = useState(false);
  useEffect(() => {
    statusSingletonChecker.runChecklist().then((result) => {
      setChecklistResult(result);
      setAllConfigsReady(result.status === 'success');
    });
  }, []);
  const [callStatus, setCallStatus] = useState("disconnected");
  const [chatWs, setChatWs] = useState<WebSocket | null>(null);
  const [chatStatus, setChatStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [userText, setUserText] = useState("");
  const transcript = useTranscript();
  const [inFlight, setInFlight] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  
  const canSendChat = chatStatus === 'connected' && userText.trim().length > 0 && !inFlight;

  // Run singleton checklist on mount, log result
  useEffect(() => {
    statusSingletonChecker.runChecklist().then(result => {
      console.log('[statusSingletonChecker] Webapp checklist result:', result.status, result.details);
    });
  }, []);

  // Logs websocket is decommissioned; chat websocket serves as the single channel

  // Hydrate last N sessions via REST and synthesize transcript events with replay:true
  async function hydrateHistory() {
    try {
      const backend = getBackendUrl();
      const limit = Number(process.env.NEXT_PUBLIC_SESSION_HISTORY_LIMIT || 3);
      const DEBUG = String(process.env.NEXT_PUBLIC_DEBUG_TRANSCRIPT || '').toLowerCase() === 'true';
      const resp = await fetch(`${backend}/api/conversations?limit=${limit}`);
      if (!resp.ok) return;
      let conversations = await resp.json();
      if (DEBUG) console.debug('[hydrateHistory] conversations:', conversations);
      // Ensure oldest-first processing so createdAtMs ascending renders chronologically
      if (Array.isArray(conversations)) conversations = conversations.slice().reverse();
      // Compute a global active conversation id: most recent with status 'open' or 'in_progress'
      const mostRecentInProgress = (Array.isArray(conversations) ? conversations.slice().filter((c: any) => String(c.status || '').toLowerCase() === 'open' || String(c.status || '').toLowerCase() === 'in_progress') : []).pop();
      const globalActiveConversationId: string | undefined = mostRecentInProgress ? mostRecentInProgress.id : undefined;
      let displayedSessionCount = 0;
      for (const s of conversations) {
        // Skip hydrating any conversation that has not ended; these render live via websockets
        if (!s.ended_at) continue;
        // Also skip the detected active conversation id as a secondary guard
        const activeConversationId = globalActiveConversationId;
        if (activeConversationId && s.id === activeConversationId) continue;
        // Fetch events for this conversation
        const ri = await fetch(`${backend}/api/conversations/${s.id}/events`);
        if (!ri.ok) continue;
        const events = await ri.json();
        // Note: all hydrated conversations are history-only now
        if (DEBUG) {
          const counts: Record<string, number> = {};
          for (const it of events) counts[it.kind] = (counts[it.kind] || 0) + 1;
          console.debug(`[hydrateHistory] conversation=${s.id} events=${events.length} kinds=`, counts);
        }
        // Establish a stable base so we can strictly order by seq
        const base = (Array.isArray(events) && events.length > 0 && events[0].created_at_ms) || Date.now();
        const seenKinds = new Set<string>();
        let emittedForThisSession = false;
        for (const it of events) {
          const kind = it.kind as string;
          const payload = it.payload || {};
          // Use a synthetic timestamp strictly increasing by seq to avoid jitter
          const ts = (typeof it.seq === 'number' ? (base + it.seq) : (it.created_at_ms || Date.now()));
          // conversation-centric: no window inference needed
          // Dedupe legacy duplicates: only one ThoughtFlow per session
          if (kind === 'thoughtflow_artifacts') {
            if (seenKinds.has('thoughtflow_artifacts')) continue;
            seenKinds.add('thoughtflow_artifacts');
          }
          if (kind === 'message_user' || kind === 'message_assistant') {
            handleEnhancedRealtimeEvent({
              type: 'conversation.item.created',
              replay: (s.id && activeConversationId && s.id === activeConversationId) ? false : true,
              session_id: s.session_id,
              conversation_id: s.id,
              __source: 'history_rest',
              item: {
                id: `ti_${it.seq}`,
                type: 'message',
                role: kind === 'message_user' ? 'user' : 'assistant',
                content: [{ type: 'text', text: String(payload.text || '') }],
                channel: payload.channel || 'text',
                supervisor: Boolean(payload.supervisor),
              },
              timestamp: ts,
            }, transcript);
            emittedForThisSession = true;
          } else if (kind === 'function_call_created') {
            handleEnhancedRealtimeEvent({
              type: 'conversation.item.created',
              replay: (s.id && activeConversationId && s.id === activeConversationId) ? false : true,
              session_id: s.session_id,
              conversation_id: s.id,
              __source: 'history_rest',
              item: {
                id: String(payload.call_id || `call_${it.seq}`),
                type: 'function_call',
                name: payload.name || 'tool',
                call_id: payload.call_id || `call_${it.seq}`,
                arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
                status: 'created',
              },
              timestamp: ts,
            }, transcript);
            emittedForThisSession = true;
          } else if (kind === 'function_call_completed') {
            handleEnhancedRealtimeEvent({
              type: 'conversation.item.completed',
              replay: (s.id && activeConversationId && s.id === activeConversationId) ? false : true,
              session_id: s.session_id,
              conversation_id: s.id,
              __source: 'history_rest',
              item: {
                id: String(payload.call_id || `call_${it.seq}`),
                type: 'function_call',
                name: payload.name || 'tool',
                call_id: payload.call_id || `call_${it.seq}`,
                arguments: typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments || {}),
                status: 'completed',
                result: typeof payload.result === 'string' ? payload.result : (payload.result ? JSON.stringify(payload.result) : undefined),
              },
              timestamp: ts,
            }, transcript);
            emittedForThisSession = true;
          } else if (kind === 'canvas') {
            handleEnhancedRealtimeEvent({
              type: 'chat.canvas',
              replay: (s.id && activeConversationId && s.id === activeConversationId) ? false : true,
              session_id: s.session_id,
              conversation_id: s.id,
              __source: 'history_rest',
              content: payload.url,
              title: payload.title,
              timestamp: ts,
              id: payload.id,
            }, transcript);
            emittedForThisSession = true;
          } else if (kind === 'thoughtflow_artifacts') {
            handleEnhancedRealtimeEvent({
              type: 'thoughtflow.artifacts',
              replay: (s.id && activeConversationId && s.id === activeConversationId) ? false : true,
              session_id: s.session_id,
              conversation_id: s.id,
              __source: 'history_rest',
              json_path: payload.json_path,
              d2_path: payload.d2_path,
              url_json: payload.url_json,
              url_d2: payload.url_d2,
              url_d2_raw: payload.url_d2_raw,
              url_d2_viewer: payload.url_d2_viewer,
              timestamp: ts,
            }, transcript);
            emittedForThisSession = true;
          }
        }
        if (emittedForThisSession) displayedSessionCount += 1;
      }
      // Send header after tallying actually displayed sessions
      handleEnhancedRealtimeEvent({ type: 'history.header', count: displayedSessionCount }, transcript);
    } catch (e) {
      console.warn('hydrateHistory failed', e);
    }
  }

  // Chat WebSocket connection
  useEffect(() => {
    if (allConfigsReady && !chatWs) {
      setChatStatus('connecting');
      const newChatWs = new WebSocket(getWebSocketUrl('/chat'));

      newChatWs.onopen = () => {
        console.log("Connected to chat websocket");
        setChatStatus('connected');
        setCallStatus('connected');
        // Hydrate history via REST when chat websocket is ready
        void hydrateHistory();
      };

      newChatWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received chat event:", data);
        // Handle chat request lifecycle events for UI state
        if (data?.type === 'chat.working') {
          setInFlight(true);
          setCurrentRequestId(data.request_id || null);
        } else if (data?.type === 'chat.done' || data?.type === 'chat.canceled') {
          setInFlight(false);
          setCurrentRequestId(null);
        }
        // Always forward events to enhanced handler; server now routes observability over chat
        try {
          (data as any).__source = 'chat_ws';
          handleEnhancedRealtimeEvent(data, transcript);
        } catch (e) {
          console.warn('Failed to handle chat event in enhanced handler', e);
        }
        // When a session is finalized, hydrate history again so the just-finished conversation moves under history
        if (data?.type === 'session.finalized') {
          void hydrateHistory();
        }
      };

      newChatWs.onclose = () => {
        console.log("Chat websocket disconnected");
        setChatWs(null);
        setChatStatus('disconnected');
        setCallStatus('disconnected');
      };

      newChatWs.onerror = (error) => {
        console.error("Chat websocket error:", error);
        setChatStatus('disconnected');
      };

      setChatWs(newChatWs);
    }
  }, [allConfigsReady, chatWs]);

  const handleSendChatMessage = (message: string) => {
    if (chatWs && chatWs.readyState === WebSocket.OPEN) {
      const chatMessage = {
        type: "chat.message",
        content: message,
        timestamp: Date.now()
      };
      console.log("Sending chat message:", chatMessage);
      chatWs.send(JSON.stringify(chatMessage));
      // Optimistically set in-flight until server confirms with chat.working
      setInFlight(true);
      // Clear input
      setUserText("");
    } else {
      console.error("Chat WebSocket not connected");
    }
  };

  const handleCancelChat = () => {
    if (!chatWs || chatWs.readyState !== WebSocket.OPEN) return;
    const cancelMessage: any = { type: 'chat.cancel' };
    if (currentRequestId) cancelMessage.request_id = currentRequestId;
    console.log('Sending chat cancel:', cancelMessage);
    chatWs.send(JSON.stringify(cancelMessage));
    // UI will reset on chat.canceled from server; keep inFlight true briefly for UX
  };

  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  // Canvas panel state
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(false);
  const [selectedCanvas, setSelectedCanvas] = useState<{ url: string; title?: string } | null>(null);

  return (
    <div className="h-screen bg-white flex flex-col">
      <Dialog open={setupDialogOpen} onOpenChange={setSetupDialogOpen}>
        <TopBar>
          <ServiceChecklist
            checklistResult={checklistResult}
            allConfigsReady={allConfigsReady}
            setAllConfigsReady={setAllConfigsReady}
          />
          <DialogTrigger asChild>
            <button
              className="p-2 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Open setup panel"
            >
              <Settings className="w-5 h-5" />
            </button>
          </DialogTrigger>
        </TopBar>
        <DialogContent className="max-w-md w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {/* Accessibility: DialogTitle for screen readers */}
          <span style={{position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0}}>
            <DialogTitle>Session Settings</DialogTitle>
          </span>
          <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
          <div className="space-y-5">

            <SessionConfigurationPanel
              callStatus={callStatus}
              onSave={(config) => {
                if (chatWs && chatWs.readyState === WebSocket.OPEN) {
                  const updateEvent = {
                    type: "session.update",
                    session: {
                      ...config,
                    },
                  };
                  console.log("Sending update event over chat WS:", updateEvent);
                  chatWs.send(JSON.stringify(updateEvent));
                }
              }}
            />
          </div>
        </DialogContent>
        <div className="flex-grow p-4 overflow-hidden flex flex-col">
          <div className="w-full h-full flex flex-col sm:flex-row gap-4 flex-grow overflow-hidden">
            {/* Transcript (left) */}
            <div className={`${canvasPanelOpen ? "hidden" : "block"} sm:block flex-1 min-w-0 min-h-0`}>
              <EnhancedTranscript
                userText={userText}
                setUserText={setUserText}
                onSendMessage={() => handleSendChatMessage(userText)}
                canSend={canSendChat}
                inFlight={inFlight}
                onCancel={handleCancelChat}
                onOpenCanvas={(canvas) => {
                  setSelectedCanvas(canvas);
                  setCanvasPanelOpen(true);
                }}
              />
            </div>

            {/* Canvas Panel (right) */}
            <CanvasPreviewPanel
              open={canvasPanelOpen}
              onOpenChange={(open) => {
                setCanvasPanelOpen(open);
                if (!open) {
                  // Optionally clear selected canvas
                  // setSelectedCanvas(null);
                }
              }}
              canvas={selectedCanvas}
            />
          </div>
        </div>
      </Dialog>
      {/* Mobile overlay renders from inside CanvasPreviewPanel when open */}
    </div>
  );
};

export default CallInterface;
