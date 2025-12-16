"use client";

import React from "react";
import { getWebSocketUrl } from "@/lib/get-backend-url";
import { CircleStop } from "lucide-react";
import { useTranscript } from "@/contexts/TranscriptContext";

export default function AdditionalTools() {
  const [ending, setEnding] = React.useState(false);
  const [status, setStatus] = React.useState<null | 'ok' | 'err'>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const transcript = useTranscript();

  const currentConversationId: string | null = React.useMemo(() => {
    try {
      const items = transcript.transcriptItems.slice().reverse();
      for (const it of items) {
        const meta = (it.data as any)?._meta;
        const convId = meta?.conversation_id as string | undefined;
        if (convId && typeof convId === 'string' && convId.trim()) return convId;
      }
    } catch {}
    return null;
  }, [transcript.transcriptItems]);

  React.useEffect(() => {
    return () => { try { wsRef.current?.close(); } catch {} };
  }, []);

  const endConversation = () => {
    try {
      setEnding(true);
      setStatus(null);
      const url = getWebSocketUrl('/chat');
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        // Require a conversation_id; do not guess on the server
        ws.send(JSON.stringify({ type: 'conversation.end', conversation_id: currentConversationId }));
        setTimeout(() => { try { ws.close(); } catch {} }, 300);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === 'conversation.finalized') setStatus(msg.ok ? 'ok' : 'err');
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
    <div className="flex items-center gap-2 flex-wrap">
      <button
          type="button"
          onClick={endConversation}
          disabled={ending || !currentConversationId}
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
        {!ending && !currentConversationId && (
          <span className="text-xs text-gray-500">No active conversation</span>
        )}
        {status === 'ok' && (
          <span className="text-xs text-green-600">Conversation finalized</span>
        )}
        {status === 'err' && (
          <span className="text-xs text-red-600">Finalize failed</span>
        )}
    </div>
  );
}
