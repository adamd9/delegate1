"use client";

import React from "react";
import VoiceMiniApp from "@/components/voice-mini-app";
import { getWebSocketUrl } from "@/lib/get-backend-url";
import { CircleStop } from "lucide-react";

export default function AdditionalTools() {
  const [ending, setEnding] = React.useState(false);
  const [status, setStatus] = React.useState<null | 'ok' | 'err'>(null);
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    return () => { try { wsRef.current?.close(); } catch {} };
  }, []);

  const endConversation = () => {
    try {
      setEnding(true);
      setStatus(null);
      const url = getWebSocketUrl('/logs');
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'session.end' }));
        setTimeout(() => { try { ws.close(); } catch {} }, 300);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === 'session.finalized') setStatus(msg.ok ? 'ok' : 'err');
        } catch {}
      };
      ws.onerror = () => setStatus('err');
      ws.onclose = () => setEnding(false);
    } catch {
      setEnding(false);
      setStatus('err');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={endConversation}
          disabled={ending}
          className={`text-sm px-2 py-1 rounded-md transition-colors border border-transparent
            ${ending 
              ? 'text-gray-500 cursor-not-allowed' 
              : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'}
          `}
          aria-label="End conversation"
          title="End conversation"
        >
          <span className="inline-flex items-center gap-1">
            <CircleStop className="w-4 h-4" />
            {ending ? 'Ending…' : 'End conversation'}
          </span>
        </button>
        {status === 'ok' && (
          <span className="text-xs text-green-600">Conversation finalized</span>
        )}
        {status === 'err' && (
          <span className="text-xs text-red-600">Finalize failed</span>
        )}
      </div>
      <VoiceMiniApp />
    </div>
  );
}
