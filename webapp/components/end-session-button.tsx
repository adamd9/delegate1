"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { getWebSocketUrl } from "@/lib/get-backend-url";
import { useTranscript } from "@/contexts/TranscriptContext";

export default function EndSessionButton() {
  const [sending, setSending] = React.useState(false);
  const [ok, setOk] = React.useState<null | boolean>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const transcript = useTranscript();

  // Heuristic: find the most recent non-replay item with a conversation_id in metadata
  const currentConversationId: string | null = React.useMemo(() => {
    try {
      const items = transcript.transcriptItems.slice().reverse();
      for (const it of items) {
        const meta = (it.data as any)?._meta;
        const convId = meta?.conversation_id as string | undefined;
        if (convId && typeof convId === 'string' && convId.trim()) {
          return convId;
        }
      }
    } catch {}
    return null;
  }, [transcript.transcriptItems]);

  React.useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  const onClick = React.useCallback(() => {
    try {
      setSending(true);
      setOk(null);
      // Lazily open a chat socket only for sending the control message
      const url = getWebSocketUrl('/chat');
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        // Require an explicit conversation_id so the server doesn't guess
        const payload: any = { type: 'conversation.end', conversation_id: currentConversationId };
        ws.send(JSON.stringify(payload));
        // we can close shortly after; server will broadcast a notification
        setTimeout(() => { try { ws.close(); } catch {} }, 300);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          // Accept either conversation.finalized (preferred) or session.finalized for backward compat
          if (msg?.type === 'conversation.finalized' || msg?.type === 'session.finalized') {
            setOk(Boolean(msg.ok));
          }
        } catch {}
      };
      ws.onerror = () => setOk(false);
      ws.onclose = () => setSending(false);
    } catch {
      setSending(false);
      setOk(false);
    }
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="destructive" onClick={onClick} disabled={sending || !currentConversationId}>
        {sending ? "Ending…" : "End Conversation"}
      </Button>
      {ok === true && <span className="text-xs text-green-600">Finalized</span>}
      {ok === false && <span className="text-xs text-red-600">Failed</span>}
      {!sending && !currentConversationId && (
        <span className="text-xs text-gray-500">No active conversation</span>
      )}
    </div>
  );
}
