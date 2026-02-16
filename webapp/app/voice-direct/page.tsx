'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getBackendUrl } from '@/lib/get-backend-url';

// ===== Voice Settings Types =====
interface VoiceSettings {
  mode: 'normal' | 'noisy';
  vad_type: 'server_vad' | 'semantic_vad' | 'none';
  threshold: number;
  prefix_padding_ms: number;
  silence_duration_ms: number;
  barge_in_grace_ms: number;
}

const FALLBACK_PRESETS: Record<'normal' | 'noisy', Omit<VoiceSettings, 'mode'>> = {
  normal: {
    vad_type: 'server_vad',
    threshold: 0.6,
    prefix_padding_ms: 80,
    silence_duration_ms: 300,
    barge_in_grace_ms: 300,
  },
  noisy: {
    vad_type: 'server_vad',
    threshold: 0.78,
    prefix_padding_ms: 220,
    silence_duration_ms: 650,
    barge_in_grace_ms: 2000,
  },
};

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
  const [showSettings, setShowSettings] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    mode: 'normal',
    ...FALLBACK_PRESETS.normal,
  });
  const [settingsApplied, setSettingsApplied] = useState(false);

  // Fetched presets from the backend (persisted voice defaults)
  const presetsRef = useRef<Record<'normal' | 'noisy', Omit<VoiceSettings, 'mode'>>>(FALLBACK_PRESETS);

  // Fetch persisted voice defaults on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/voice-defaults`);
        if (!res.ok) return;
        const data = await res.json();
        const fetched: Record<'normal' | 'noisy', Omit<VoiceSettings, 'mode'>> = {
          normal: {
            vad_type: data.normal?.vad_type ?? FALLBACK_PRESETS.normal.vad_type,
            threshold: data.normal?.threshold ?? FALLBACK_PRESETS.normal.threshold,
            prefix_padding_ms: data.normal?.prefix_padding_ms ?? FALLBACK_PRESETS.normal.prefix_padding_ms,
            silence_duration_ms: data.normal?.silence_duration_ms ?? FALLBACK_PRESETS.normal.silence_duration_ms,
            barge_in_grace_ms: data.normal?.barge_in_grace_ms ?? FALLBACK_PRESETS.normal.barge_in_grace_ms,
          },
          noisy: {
            vad_type: data.noisy?.vad_type ?? FALLBACK_PRESETS.noisy.vad_type,
            threshold: data.noisy?.threshold ?? FALLBACK_PRESETS.noisy.threshold,
            prefix_padding_ms: data.noisy?.prefix_padding_ms ?? FALLBACK_PRESETS.noisy.prefix_padding_ms,
            silence_duration_ms: data.noisy?.silence_duration_ms ?? FALLBACK_PRESETS.noisy.silence_duration_ms,
            barge_in_grace_ms: data.noisy?.barge_in_grace_ms ?? FALLBACK_PRESETS.noisy.barge_in_grace_ms,
          },
        };
        presetsRef.current = fetched;
        // Update current settings to match fetched normal preset
        setVoiceSettings((prev) => ({ ...prev, ...fetched[prev.mode] }));
      } catch {
        // silently fall back to hardcoded
      }
    })();
  }, [backendUrl]);

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
  const holdSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, message, type }].slice(-50));
  };

  const sendVoiceSettings = useCallback((settings: VoiceSettings) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      event: 'voice_settings',
      settings: {
        mode: settings.mode,
        vad_type: settings.vad_type,
        threshold: settings.threshold,
        prefix_padding_ms: settings.prefix_padding_ms,
        silence_duration_ms: settings.silence_duration_ms,
        barge_in_grace_ms: settings.barge_in_grace_ms,
      },
    }));
    setSettingsApplied(false);
    addLog(`Voice settings sent: ${settings.mode} (threshold=${settings.threshold}, silence=${settings.silence_duration_ms}ms, barge-in=${settings.barge_in_grace_ms}ms)`, 'info');
  }, []);

  // Debounce slider changes to avoid flooding the WebSocket
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendDebounced = useCallback((settings: VoiceSettings) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => sendVoiceSettings(settings), 200);
  }, [sendVoiceSettings]);

  const applyPreset = useCallback((mode: 'normal' | 'noisy') => {
    const next: VoiceSettings = { mode, ...presetsRef.current[mode] };
    setVoiceSettings(next);
    sendVoiceSettings(next); // presets send immediately (no debounce)
  }, [sendVoiceSettings]);

  const updateSetting = useCallback(<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => {
    setVoiceSettings((prev) => {
      const next = { ...prev, [key]: value };
      sendDebounced(next);
      return next;
    });
  }, [sendDebounced]);

  const playHoldPcm16 = async (base64: string, sampleRate = 24000) => {
    const ctx = await ensureAudioContext();
    const int16 = base64ToInt16(base64);
    const floats = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, floats.length, sampleRate);
    buffer.copyToChannel(floats, 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    holdSourcesRef.current.add(src);
    src.onended = () => {
      try {
        holdSourcesRef.current.delete(src);
      } catch {}
    };
    // Start ASAP; hold tone should not be queued behind assistant audio
    src.start(ctx.currentTime + 0.01);
  };

  const clearHoldPlayback = () => {
    for (const src of Array.from(holdSourcesRef.current)) {
      try {
        src.onended = null;
        src.stop(0);
      } catch {}
      try {
        holdSourcesRef.current.delete(src);
      } catch {}
    }
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
          if (msg?.event === 'voice_settings_ack') {
            setSettingsApplied(true);
            addLog(`Voice settings applied (model=${msg.settings?.applied_to_model ? 'yes' : 'no'})`, 'success');
            return;
          }
          if (msg?.event === 'clear') {
            await clearPlayback();
            return;
          }
          if (msg?.event === 'hold.clear') {
            clearHoldPlayback();
            return;
          }
          if (msg?.event === 'hold.media' && msg?.media?.payload) {
            await playHoldPcm16(msg.media.payload, 24000);
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
    <div className="min-h-screen bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-white p-4">
      <div className="flex flex-col lg:flex-row gap-4 max-w-4xl w-full">
        {/* Main panel */}
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 text-center shadow-2xl flex-1 min-w-0">
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

            <div className="flex gap-2">
              <button
                onClick={isConnected ? disconnect : connect}
                disabled={isConnecting}
                className={`flex-1 p-3 rounded-xl font-semibold transition-all ${
                  isConnecting
                    ? 'bg-gray-500/50 cursor-not-allowed'
                    : isConnected
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-emerald-500 hover:bg-emerald-600'
                }`}
              >
                {isConnecting ? 'Connecting…' : isConnected ? 'Disconnect' : 'Connect & Stream Mic'}
              </button>
              <button
                onClick={() => setShowSettings((v) => !v)}
                className={`p-3 rounded-xl font-semibold transition-all ${
                  showSettings ? 'bg-white/30' : 'bg-white/10 hover:bg-white/20'
                }`}
                title="Voice Settings"
              >
                ⚙️
              </button>
            </div>

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

        {/* Voice Settings Panel */}
        {showSettings && (
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 shadow-2xl lg:w-80 w-full">
            <h2 className="text-xl font-bold mb-4">Voice Settings</h2>
            <p className="text-xs text-white/60 mb-4">
              Adjust VAD &amp; barge-in in real time. Changes are sent immediately to the backend and applied to the active OpenAI Realtime session.
            </p>

            {/* Preset toggle */}
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2">Preset</label>
              <div className="flex gap-2">
                <button
                  onClick={() => applyPreset('normal')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                    voiceSettings.mode === 'normal'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white/10 hover:bg-white/20 text-white/80'
                  }`}
                >
                  Normal
                </button>
                <button
                  onClick={() => applyPreset('noisy')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                    voiceSettings.mode === 'noisy'
                      ? 'bg-amber-500 text-white'
                      : 'bg-white/10 hover:bg-white/20 text-white/80'
                  }`}
                >
                  Noisy
                </button>
              </div>
            </div>

            {/* VAD Type */}
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">VAD Type</label>
              <select
                value={voiceSettings.vad_type}
                onChange={(e) => updateSetting('vad_type', e.target.value as VoiceSettings['vad_type'])}
                className="w-full p-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                <option value="server_vad" className="text-gray-900">server_vad</option>
                <option value="semantic_vad" className="text-gray-900">semantic_vad</option>
                <option value="none" className="text-gray-900">none (manual)</option>
              </select>
            </div>

            {voiceSettings.vad_type !== 'none' && (
              <>
                {/* Threshold */}
                <SliderSetting
                  label="Threshold"
                  description="Higher = less sensitive to speech"
                  value={voiceSettings.threshold}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={voiceSettings.threshold.toFixed(2)}
                  onChange={(v) => updateSetting('threshold', v)}
                />

                {/* Prefix Padding */}
                <SliderSetting
                  label="Prefix Padding"
                  description="Min ms of speech before start"
                  value={voiceSettings.prefix_padding_ms}
                  min={0}
                  max={1000}
                  step={10}
                  displayValue={`${voiceSettings.prefix_padding_ms}ms`}
                  onChange={(v) => updateSetting('prefix_padding_ms', v)}
                />

                {/* Silence Duration */}
                <SliderSetting
                  label="Silence Duration"
                  description="Ms of silence before turn ends"
                  value={voiceSettings.silence_duration_ms}
                  min={50}
                  max={2000}
                  step={10}
                  displayValue={`${voiceSettings.silence_duration_ms}ms`}
                  onChange={(v) => updateSetting('silence_duration_ms', v)}
                />
              </>
            )}

            {/* Barge-in Grace — with disable toggle */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-semibold text-white/80">Barge-in Grace</label>
                <button
                  type="button"
                  onClick={() => updateSetting('barge_in_grace_ms', voiceSettings.barge_in_grace_ms === 0 ? 300 : 0)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                    voiceSettings.barge_in_grace_ms === 0
                      ? 'bg-white/10 text-white/50'
                      : 'bg-purple-500/30 text-purple-300'
                  }`}
                >
                  {voiceSettings.barge_in_grace_ms === 0 ? 'Disabled' : 'Enabled'}
                </button>
              </div>
              {voiceSettings.barge_in_grace_ms === 0 ? (
                <p className="text-xs text-white/40">
                  App-level barge-in protection is off — the API&apos;s own VAD handles interruptions.
                </p>
              ) : (
                <SliderSetting
                  label=""
                  description="Min ms of assistant audio before allowing interruption"
                  value={voiceSettings.barge_in_grace_ms}
                  min={50}
                  max={5000}
                  step={50}
                  displayValue={`${voiceSettings.barge_in_grace_ms}ms`}
                  onChange={(v) => updateSetting('barge_in_grace_ms', v)}
                />
              )}
            </div>

            {settingsApplied && (
              <div className="mt-3 text-xs text-green-300 bg-green-500/10 rounded-lg p-2 text-center">
                Settings applied to active session
              </div>
            )}
            {!isConnected && (
              <div className="mt-3 text-xs text-yellow-300 bg-yellow-500/10 rounded-lg p-2 text-center">
                Connect first — settings will be sent on change
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Slider Setting Component =====
function SliderSetting({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-sm font-semibold">{label}</label>
        <span className="text-xs text-white/80 font-mono">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-300"
      />
      <div className="text-xs text-white/50 mt-0.5">{description}</div>
    </div>
  );
}
