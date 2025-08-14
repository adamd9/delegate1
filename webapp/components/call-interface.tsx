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
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [chatWs, setChatWs] = useState<WebSocket | null>(null);
  const [chatStatus, setChatStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [userText, setUserText] = useState("");
  const transcript = useTranscript();
  
  const canSendChat = chatStatus === 'connected' && userText.trim().length > 0;

  // Run singleton checklist on mount, log result
  useEffect(() => {
    statusSingletonChecker.runChecklist().then(result => {
      console.log('[statusSingletonChecker] Webapp checklist result:', result.status, result.details);
    });
  }, []);

  useEffect(() => {
    if (allConfigsReady && !ws) {
      const newWs = new WebSocket(getWebSocketUrl('/logs'));

      newWs.onopen = () => {
        console.log("Connected to logs websocket");
        setCallStatus("connected");
      };

      newWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received logs event:", data);
        // Handle both old and new transcript systems
        // handleRealtimeEvent(data, setItems); // setItems is not defined, removed
        handleEnhancedRealtimeEvent(data, transcript);
      };

      newWs.onclose = () => {
        console.log("Logs websocket disconnected");
        setWs(null);
        setCallStatus("disconnected");
      };

      setWs(newWs);
    }
  }, [allConfigsReady, ws]);

  // Chat WebSocket connection
  useEffect(() => {
    if (allConfigsReady && !chatWs) {
      setChatStatus('connecting');
      const newChatWs = new WebSocket(getWebSocketUrl('/chat'));

      newChatWs.onopen = () => {
        console.log("Connected to chat websocket");
        setChatStatus('connected');
      };

      newChatWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received chat event:", data);
        
        // Chat WebSocket is used for sending messages only
        // Responses are handled via logs WebSocket for consistency
      };

      newChatWs.onclose = () => {
        console.log("Chat websocket disconnected");
        setChatWs(null);
        setChatStatus('disconnected');
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
      
      // Clear input
      setUserText("");
    } else {
      console.error("Chat WebSocket not connected");
    }
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
                if (ws && ws.readyState === WebSocket.OPEN) {
                  const updateEvent = {
                    type: "session.update",
                    session: {
                      ...config,
                    },
                  };
                  console.log("Sending update event:", updateEvent);
                  ws.send(JSON.stringify(updateEvent));
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
