"use client";

import React, { useState, useEffect } from "react";
import TopBar from "@/components/top-bar";
// Decommissioned settings overlay; settings live at /settings
import { EnhancedTranscript } from "@/components/enhanced-transcript";
import CanvasPreviewPanel from "@/components/canvas-preview-panel";

import { Item } from "@/components/types";
import handleEnhancedRealtimeEvent from "@/lib/handle-enhanced-realtime-event";
import ServiceChecklist from "@/components/phone-number-checklist";
import { useTranscript } from "@/contexts/TranscriptContext";
import { getWebSocketUrl } from "@/lib/get-backend-url";



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

  // History replay is now server-initiated on connect. No client requests are sent.

  // Chat WebSocket connection
  useEffect(() => {
    if (allConfigsReady && !chatWs) {
      setChatStatus('connecting');
      const newChatWs = new WebSocket(getWebSocketUrl('/chat'));

      newChatWs.onopen = () => {
        console.log("Connected to chat websocket");
        setChatStatus('connected');
        setCallStatus('connected');
        // Server will auto-replay ended runs and the current open run on connect
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
        // When a conversation is finalized, reload so it moves under history immediately
        if (data?.type === 'conversation.finalized') {
          try { window.location.reload(); } catch {}
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

  // Canvas panel state
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(false);
  const [selectedCanvas, setSelectedCanvas] = useState<{ url: string; title?: string } | null>(null);

  return (
    <div className="h-screen bg-white flex flex-col">
      <TopBar>
        <ServiceChecklist
          checklistResult={checklistResult}
          allConfigsReady={allConfigsReady}
          setAllConfigsReady={setAllConfigsReady}
        />
      </TopBar>
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
      {/* Mobile overlay renders from inside CanvasPreviewPanel when open */}
    </div>
  );
}
;

export default CallInterface;
