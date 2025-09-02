"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { getWebSocketUrl } from "@/lib/get-backend-url";

export default function EndSessionButton() {
  const [sending, setSending] = React.useState(false);
  const [ok, setOk] = React.useState<null | boolean>(null);
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  const onClick = React.useCallback(() => {
    try {
      setSending(true);
      setOk(null);
      // Lazily open a logs socket only for sending the control message
      const url = getWebSocketUrl('/logs');
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'session.end' }));
        // we can close shortly after; server will broadcast a notification
        setTimeout(() => { try { ws.close(); } catch {} }, 300);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === 'session.finalized') {
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
      <Button size="sm" variant="destructive" onClick={onClick} disabled={sending}>
        {sending ? "Ending…" : "End Session"}
      </Button>
      {ok === true && <span className="text-xs text-green-600">Finalized</span>}
      {ok === false && <span className="text-xs text-red-600">Failed</span>}
    </div>
  );
}
