"use client";

import React, { useState, useEffect } from "react";
import TopBar from "@/components/top-bar";
import SessionConfigurationPanel from "@/components/session-configuration-panel";
import { EnhancedTranscript } from "@/components/enhanced-transcript";
import FunctionCallsPanel from "@/components/function-calls-panel";
import { Item } from "@/components/types";
import handleRealtimeEvent from "@/lib/handle-realtime-event";
import handleEnhancedRealtimeEvent from "@/lib/handle-enhanced-realtime-event";
import PhoneNumberChecklist from "@/components/phone-number-checklist";
import { useTranscript } from "@/contexts/TranscriptContext";
import { getBackendUrl, getWebSocketUrl } from "@/lib/get-backend-url";

import { useSetupChecklist } from "@/lib/hooks/useSetupChecklist";

import statusSingletonChecker from "../lib/statusSingletonChecker";

const CallInterface = () => {
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState("");
  const [allConfigsReady, setAllConfigsReady] = useState(false);
  // Use setup checklist at the top level
  const [setupState, setupActions] = useSetupChecklist(selectedPhoneNumber, setSelectedPhoneNumber);
  const [items, setItems] = useState<Item[]>([]);
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
        handleRealtimeEvent(data, setItems);
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

  return (
    <div className="h-screen bg-white flex flex-col">
      <TopBar />
      <div className="flex-grow p-4 overflow-hidden flex flex-col">
        <div className="grid grid-cols-12 gap-4 flex-grow overflow-hidden">
          {/* Left Column */}
          <div className="col-span-3 flex flex-col h-full overflow-hidden">
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

          {/* Middle Column: Transcript */}
          <div className="col-span-6 flex flex-col gap-4 h-full overflow-hidden">
            <div className="flex-shrink-0">
              <PhoneNumberChecklist
                selectedPhoneNumber={selectedPhoneNumber}
                setSelectedPhoneNumber={setSelectedPhoneNumber}
                allConfigsReady={allConfigsReady}
                setAllConfigsReady={setAllConfigsReady}
                checklist={setupState.checklist}
                allChecksPassed={setupState.allChecksPassed}
              />
            </div>
            <div className="flex-1 min-h-0">
              <EnhancedTranscript
                userText={userText}
                setUserText={setUserText}
                onSendMessage={() => handleSendChatMessage(userText)}
                canSend={canSendChat}
              />
            </div>
          </div>

          {/* Right Column: Function Calls */}
          <div className="col-span-3 flex flex-col h-full overflow-hidden">
            <FunctionCallsPanel items={items} ws={ws} />
          </div>
        </div>
        
        {/* Chat input is now integrated into the enhanced transcript */}
      </div>
    </div>
  );
};

export default CallInterface;
