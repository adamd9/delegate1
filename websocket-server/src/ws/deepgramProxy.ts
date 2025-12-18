import { WebSocket } from 'ws';
import type { RawData } from 'ws';

export function establishDeepgramProxy(clientWs: WebSocket) {
  const apiKey = process.env.DEEPGRAM_API_KEY || '';
  if (!apiKey) {
    try {
      clientWs.send(JSON.stringify({ type: 'error', message: 'DEEPGRAM_API_KEY is not set on server' }));
    } catch {}
    try {
      clientWs.close();
    } catch {}
    return;
  }

  const deepgramUrl =
    'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&language=en&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing=250';

  const upstream = new WebSocket(deepgramUrl, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  });

  // Buffer messages from client until Deepgram websocket is open.
  const pending: Array<RawData> = [];
  let upstreamOpen = false;

  upstream.on('open', () => {
    upstreamOpen = true;
    try {
      clientWs.send(JSON.stringify({ type: 'proxy_open' }));
    } catch {}

    if (pending.length) {
      for (const msg of pending) {
        try {
          upstream.send(msg);
        } catch {}
      }
      pending.length = 0;
    }
  });

  upstream.on('message', (data, isBinary) => {
    try {
      // Preserve frame type. Deepgram sends JSON text; if we forward a Buffer,
      // the browser receives a binary frame (Blob/ArrayBuffer) and JSON.parse fails.
      if (isBinary) {
        clientWs.send(data);
      } else {
        clientWs.send(data.toString());
      }
    } catch {}
  });

  upstream.on('close', (code, reason) => {
    try {
      clientWs.close(code, reason?.toString?.() || undefined);
    } catch {}
  });

  upstream.on('error', (err) => {
    try {
      clientWs.send(JSON.stringify({ type: 'error', message: (err as any)?.message || String(err) }));
    } catch {}
    try {
      clientWs.close();
    } catch {}
  });

  clientWs.on('message', (data) => {
    try {
      if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
        upstream.send(data);
      } else {
        pending.push(data);
      }
    } catch {}
  });

  clientWs.on('close', () => {
    try {
      upstreamOpen = false;
      pending.length = 0;
    } catch {}
    try {
      upstream.close();
    } catch {}
  });

  clientWs.on('error', () => {
    try {
      upstream.close();
    } catch {}
  });
}
