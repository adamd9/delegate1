'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getBackendUrl } from '@/lib/get-backend-url';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

function base64ToInt16(base64: string): Int16Array {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function clampToInt16(v: number): number {
  const x = Math.max(-1, Math.min(1, v));
  return (x < 0 ? x * 0x8000 : x * 0x7fff) | 0;
}

function resampleFloat32Linear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const t = i * ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = t - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export default function VoiceDirectPage() {
  const [status, setStatus] = useState('Disconnected');
  const [statusClass, setStatusClass] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [backendUrl, setBackendUrl] = useState(getBackendUrl());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const wsUrl = useMemo(() => {
    const wsProtocol = backendUrl.startsWith('https://') ? 'wss://' : 'ws://';
    const hostWithPath = backendUrl.replace(/^https?:\/\//, '') + '/browser-call';
    return `${wsProtocol}${hostWithPath}`;
  }, [backendUrl]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const playbackTimeRef = useRef<number>(0);
  const playbackMutedUntilRef = useRef<number>(0);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, message, type }].slice(-50));
  };

  const updateStatus = (newStatus: string, cls: typeof statusClass) => {
    setStatus(newStatus);
    setStatusClass(cls);
  };

  const ensureAudioContext = async (targetSampleRate = 48000) => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const ctx = new AudioContext({ sampleRate: targetSampleRate });
    audioCtxRef.current = ctx;
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
    return ctx;
  };

  const playPcm16 = async (base64: string, sampleRate = 24000) => {
    const ctx = await ensureAudioContext();
    const now = ctx.currentTime;
    if (now < (playbackMutedUntilRef.current || 0)) return;
    const int16 = base64ToInt16(base64);
    const floats = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, floats.length, sampleRate);
    buffer.copyToChannel(floats, 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    playbackSourcesRef.current.add(src);
    src.onended = () => {
      try {
        playbackSourcesRef.current.delete(src);
      } catch {}
    };

    const startAt = Math.max(now + 0.02, playbackTimeRef.current || now + 0.02);
    src.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
  };

  const clearPlayback = async () => {
    try {
      const ctx = await ensureAudioContext();
      const now = ctx.currentTime;
      // Reset queue and briefly mute to avoid race with already-in-flight WS messages
      playbackTimeRef.current = now;
      playbackMutedUntilRef.current = now + 0.6;
      // Stop any scheduled/playing sources immediately
      for (const src of Array.from(playbackSourcesRef.current)) {
        try {
          src.onended = null;
          src.stop(0);
        } catch {}
        try {
          playbackSourcesRef.current.delete(src);
        } catch {}
      }
    } catch {}
  };

  const connect = async () => {
    if (isConnected || isConnecting) return;

    try {
      setIsConnecting(true);
      updateStatus('Connecting…', 'connecting');

      addLog(`Connecting to: ${wsUrl}`, 'info');

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        try {
          addLog('WebSocket connected', 'success');
          updateStatus('Connected', 'connected');
          setIsConnected(true);
          setIsConnecting(false);

          const ctx = await ensureAudioContext();
          playbackTimeRef.current = ctx.currentTime + 0.05;

          ws.send(JSON.stringify({ event: 'start' }));

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
            },
          });

          micStreamRef.current = stream;

          const source = ctx.createMediaStreamSource(stream);
          sourceRef.current = source;

          const processor = ctx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          const inRate = ctx.sampleRate;
          const outRate = 24000;
          let floatCarry = new Float32Array(0);

          processor.onaudioprocess = (evt) => {
            try {
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

              const input = evt.inputBuffer.getChannelData(0);
              const merged = new Float32Array(floatCarry.length + input.length);
              merged.set(floatCarry, 0);
              merged.set(input, floatCarry.length);

              const resampled = resampleFloat32Linear(merged, inRate, outRate);

              const frameSamples = Math.floor(outRate * 0.05);
              if (resampled.length < frameSamples) {
                floatCarry = merged;
                return;
              }

              const usableFrames = Math.floor(resampled.length / frameSamples);
              const usableSamples = usableFrames * frameSamples;

              for (let f = 0; f < usableFrames; f++) {
                const start = f * frameSamples;
                const slice = resampled.subarray(start, start + frameSamples);
                const pcm16 = new Int16Array(slice.length);
                for (let i = 0; i < slice.length; i++) pcm16[i] = clampToInt16(slice[i]);

                wsRef.current.send(
                  JSON.stringify({
                    event: 'media',
                    media: {
                      timestamp: Date.now(),
                      payload: int16ToBase64(pcm16),
                    },
                  }),
                );
              }

              const consumedAtIn = Math.floor(usableSamples * (inRate / outRate));
              floatCarry = merged.subarray(consumedAtIn);
            } catch {
              // ignore
            }
          };

          source.connect(processor);
          processor.connect(ctx.destination);

          addLog('Microphone streaming started (PCM16 @ 24kHz)', 'success');
        } catch (err: any) {
          addLog(`Failed to start mic: ${err?.message || err}`, 'error');
          await disconnect();
        }
      };

      ws.onmessage = async (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.event === 'clear') {
            await clearPlayback();
            return;
          }
          if (msg?.event === 'media' && msg?.media?.payload) {
            await playPcm16(msg.media.payload, 24000);
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        addLog('WebSocket error', 'error');
      };

      ws.onclose = () => {
        addLog('WebSocket closed', 'info');
        void disconnect();
      };
    } catch (err: any) {
      addLog(`Connect failed: ${err?.message || err}`, 'error');
      updateStatus('Disconnected', 'disconnected');
      setIsConnecting(false);
      setIsConnected(false);
    }
  };

  const disconnect = async () => {
    try {
      setIsConnecting(false);
      setIsConnected(false);
      updateStatus('Disconnected', 'disconnected');

      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ event: 'close' }));
        }
      } catch {}

      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;

      try {
        processorRef.current?.disconnect();
      } catch {}
      processorRef.current = null;

      try {
        sourceRef.current?.disconnect();
      } catch {}
      sourceRef.current = null;

      try {
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
      micStreamRef.current = null;

      addLog('Disconnected', 'success');
    } catch (err: any) {
      addLog(`Disconnect error: ${err?.message || err}`, 'error');
    }
  };

  useEffect(() => {
    addLog('Direct voice client initialized', 'info');
    return () => {
      void disconnect();
      try {
        audioCtxRef.current?.close();
      } catch {}
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-white">
      <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 text-center shadow-2xl max-w-md w-full mx-4">
        <h1 className="text-3xl font-bold mb-2">Delegate 1</h1>
        <p className="text-emerald-100 mb-8">Direct Voice (Browser → Backend → OpenAI)</p>

        <div
          className={`status mb-6 p-4 rounded-xl text-lg font-semibold ${
            statusClass === 'connected'
              ? 'bg-green-500/20 text-green-100'
              : statusClass === 'connecting'
                ? 'bg-yellow-500/20 text-yellow-100'
                : 'bg-red-500/20 text-red-100'
          }`}
        >
          {status}
        </div>

        <div className="space-y-4 mb-6">
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="Backend URL (e.g., http://localhost:8081)"
            className="w-full p-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/30"
          />

          <button
            onClick={isConnected ? disconnect : connect}
            disabled={isConnecting}
            className={`w-full p-3 rounded-xl font-semibold transition-all ${
              isConnecting
                ? 'bg-gray-500/50 cursor-not-allowed'
                : isConnected
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-emerald-500 hover:bg-emerald-600'
            }`}
          >
            {isConnecting ? 'Connecting…' : isConnected ? 'Disconnect' : 'Connect & Stream Mic'}
          </button>

          <div className="text-xs text-white/70 text-left">
            <div>WS: {wsUrl}</div>
            <div>Upstream: PCM16 mono @ 24kHz (resampled from browser)</div>
            <div>Downstream: PCM16 mono @ 24kHz</div>
          </div>
        </div>

        <div className="bg-black/20 rounded-xl p-4 max-h-64 overflow-y-auto">
          <h3 className="text-lg font-semibold mb-3">Logs</h3>
          <div className="space-y-1 text-sm text-left">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`${
                  log.type === 'success'
                    ? 'text-green-300'
                    : log.type === 'error'
                      ? 'text-red-300'
                      : 'text-emerald-100'
                }`}
              >
                [{log.timestamp}] {log.message}
              </div>
            ))}
            {logs.length === 0 && <div className="text-white/60 italic">No logs yet...</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
