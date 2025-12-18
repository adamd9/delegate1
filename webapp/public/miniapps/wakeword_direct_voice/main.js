document.addEventListener('DOMContentLoaded', () => {
  const actionBtn = document.getElementById('action-btn');
  const statusCircle = document.getElementById('status-circle');
  const statusRing = document.getElementById('status-ring');
  const statusText = document.getElementById('status-text');

  const settingsToggleBtn = document.getElementById('settings-toggle');
  const panelOverlayEl = document.getElementById('panel-overlay');
  const panelCloseBtn = document.getElementById('panel-close');
  const tabDiagnosticsBtn = document.getElementById('tab-diagnostics');
  const tabSettingsBtn = document.getElementById('tab-settings');
  const panelDiagnosticsEl = document.getElementById('panel-body-diagnostics');
  const panelSettingsEl = document.getElementById('panel-body-settings');

  const diagStatusEl = document.getElementById('diag-status');
  const diagVadEl = document.getElementById('diag-vad');
  const diagSpeechEl = document.getElementById('diag-speech');
  const diagDgEl = document.getElementById('diag-dg');
  const diagAgentEl = document.getElementById('diag-agent');
  const diagTranscriptEl = document.getElementById('diag-transcript');

  const settingsPhrasesEl = document.getElementById('settings-phrases');
  const settingsVadThresholdEl = document.getElementById('settings-vad-threshold');
  const settingsVadThresholdValueEl = document.getElementById('settings-vad-threshold-value');

  const DBG_PREFIX = '[wakeword_direct_voice]';
  function dbg(...args) {
    try {
      console.log(DBG_PREFIX, ...args);
    } catch {}
  }
  function dbgErr(...args) {
    try {
      console.error(DBG_PREFIX, ...args);
    } catch {}
  }

  let keywordPhrases = ['hi', 'hey', 'hey hk', 'hi hk', 'hey, hk', 'hi, hk', 'hey, h k', 'hi, h k'];

  // ===== Local VAD =====
  const SAMPLE_RATE = 16000;
  const FRAME_SIZE = 1280; // 80ms

  let isRunning = false;

  let audioContext = null;
  let workletNode = null;
  let gainNode = null;
  let mediaStream = null;

  let vadModel = null;
  let vadState = { h: null, c: null };

  // We use local VAD to control Deepgram streaming
  const VAD_HANGOVER_FRAMES = 8;
  let vadHangoverCounter = 0;
  let isSpeechActive = false;
  let vadThreshold = 0.5;

  // UI-level control state (single button)
  let uiControlMode = 'idle'; // idle | listening | agent

  // Used to cancel an in-flight startListening() if the user hits Stop mid-start.
  let startListeningToken = 0;

  function setActionButton(mode) {
    uiControlMode = mode;
    try {
      if (!actionBtn) return;
      if (mode === 'idle') {
        actionBtn.textContent = 'Start';
        actionBtn.disabled = false;
        actionBtn.classList.remove('danger');
        actionBtn.classList.add('primary');
      } else if (mode === 'listening') {
        actionBtn.textContent = 'Stop';
        actionBtn.disabled = false;
        actionBtn.classList.remove('danger');
        actionBtn.classList.add('primary');
      } else {
        // agent
        actionBtn.textContent = 'Hang up';
        actionBtn.disabled = false;
        actionBtn.classList.remove('primary');
        actionBtn.classList.add('danger');
      }
    } catch {}
  }

  // ===== Deepgram proxy streaming =====
  const DEEPGRAM_PREROLL_CHUNKS = 6; // ~480ms
  let dgWs = null;
  let dgIsOpening = false;
  let dgCloseTimer = null;
  let dgCloseRequested = false;

  let dgTranscriptFinal = '';
  let dgTranscriptInterim = '';
  let dgUtteranceMatched = false;

  let dgPreRollBuffer = [];
  let dgPendingPreRoll = [];
  let dgPendingConnectAudio = [];

  // ===== Agent (browser-call) =====
  let agentWs = null;
  let agentIsConnecting = false;
  let agentIsConnected = false;

  // Audio streaming to agent (duplicated from voice-direct; ScriptProcessor for simplicity)
  let agentAudioCtx = null;
  let agentMicStream = null;
  let agentSource = null;
  let agentProcessor = null;

  // Downstream audio playback (PCM16 @ 24kHz)
  const playbackCtxRef = { current: null };
  const playbackTimeRef = { current: 0 };
  const playbackSourcesRef = { current: new Set() };
  const holdSourcesRef = { current: new Set() };

  async function waitForOrtReady() {
    dbg('waitForOrtReady: start', { hasOrt: !!(typeof window !== 'undefined' && window.ort) });
    if (typeof window !== 'undefined' && window.ort?.InferenceSession) return;
    const startedAt = Date.now();
    while (!(typeof window !== 'undefined' && window.ort?.InferenceSession)) {
      if (Date.now() - startedAt > 8000) {
        throw new Error('ONNX Runtime (ort) did not load');
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    dbg('waitForOrtReady: ready');
  }

  function setState(label, color) {
    statusText.textContent = label;
    try {
      if (diagStatusEl) diagStatusEl.textContent = label;
    } catch {}
    statusRing.style.borderColor = color;
    statusRing.style.boxShadow = `0 0 28px ${color}55`;
    statusCircle.style.background = `${color}22`;
  }

  const UI_MODES = [
    'mode-idle',
    'mode-listening',
    'mode-detecting',
    'mode-wakeword',
    'mode-agent-connecting',
    'mode-agent-connected',
  ];

  function setUiMode(mode) {
    try {
      for (const m of UI_MODES) document.body.classList.remove(m);
      if (mode) document.body.classList.add(mode);
    } catch {}
  }

  let pendingUiStateTimer = null;
  let lastUiAppliedAt = 0;
  let lastUiKey = '';

  function requestUiState({ label, color, mode, minDwellMs = 320 }) {
    const now = Date.now();
    const key = `${label}|${color}|${mode}`;
    if (key === lastUiKey) return;

    const elapsed = now - lastUiAppliedAt;
    const delay = Math.max(0, minDwellMs - elapsed);

    if (pendingUiStateTimer) {
      clearTimeout(pendingUiStateTimer);
      pendingUiStateTimer = null;
    }

    const apply = () => {
      pendingUiStateTimer = null;
      lastUiAppliedAt = Date.now();
      lastUiKey = key;
      setUiMode(mode);
      setState(label, color);
    };

    if (delay <= 0) apply();
    else pendingUiStateTimer = setTimeout(apply, delay);
  }

  function setSpeakingClass(className, on) {
    try {
      document.body.classList.toggle(className, !!on);
    } catch {}
  }

  function setVADLevel(level) {
    const clamped = Math.max(0, Math.min(1, level));
    try {
      if (diagVadEl) diagVadEl.textContent = clamped.toFixed(2);
    } catch {}
    const scale = 1 + 0.06 * clamped;
    statusCircle.style.transform = `scale(${scale.toFixed(3)})`;
  }

  function normalizeTextForMatch(text) {
    // Lowercase, strip punctuation, collapse whitespace.
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function keywordMatchesTranscript(keywordPhrases, transcript) {
    const t = normalizeTextForMatch(transcript);
    if (!t) return false;
    for (const phrase of keywordPhrases) {
      const k = normalizeTextForMatch(phrase);
      if (k && t.includes(k)) return true;
    }
    return false;
  }

  // Cache backend URL to avoid hammering /api/backend-url when VAD triggers reconnects.
  let cachedBackendHttpUrl = null;
  let backendHttpUrlPromise = null;

  async function getBackendHttpUrl() {
    if (cachedBackendHttpUrl) return cachedBackendHttpUrl;
    if (backendHttpUrlPromise) return backendHttpUrlPromise;

    backendHttpUrlPromise = (async () => {
      let backendUrl = 'http://localhost:8081';
      try {
        const resp = await fetch('/api/backend-url', { cache: 'no-store' });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.backendUrl) backendUrl = data.backendUrl;
        }
      } catch {
        // ignore
      }
      cachedBackendHttpUrl = backendUrl;
      return backendUrl;
    })();

    try {
      return await backendHttpUrlPromise;
    } finally {
      backendHttpUrlPromise = null;
    }
  }

  async function getBackendWsUrl(path) {
    const backendUrl = await getBackendHttpUrl();
    const wsProtocol = backendUrl.startsWith('https://') ? 'wss://' : 'ws://';
    const hostWithPath = backendUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + path;
    return `${wsProtocol}${hostWithPath}`;
  }

  function float32ToLinear16PcmBytes(float32Array) {
    const buf = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  function clampToInt16(v) {
    if (v > 32767) return 32767;
    if (v < -32768) return -32768;
    return v | 0;
  }

  function int16ToBase64(int16) {
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  }

  function base64ToInt16(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }

  async function ensurePlaybackContext() {
    if (playbackCtxRef.current) return playbackCtxRef.current;
    playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    playbackTimeRef.current = playbackCtxRef.current.currentTime;
    return playbackCtxRef.current;
  }

  async function playPcm16(base64, sampleRate = 24000) {
    // Visual: agent is speaking whenever we receive playback frames.
    try {
      setSpeakingClass('agent-speaking', true);
      if (playPcm16.__agentSpeakTimer) clearTimeout(playPcm16.__agentSpeakTimer);
      playPcm16.__agentSpeakTimer = setTimeout(() => setSpeakingClass('agent-speaking', false), 260);
    } catch {}

    const ctx = await ensurePlaybackContext();
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

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, playbackTimeRef.current + 0.01);
    playbackTimeRef.current = startAt + buffer.duration;
    src.start(startAt);
  }

  function clearPlayback() {
    for (const src of Array.from(playbackSourcesRef.current)) {
      try {
        src.onended = null;
        src.stop(0);
      } catch {}
      try {
        playbackSourcesRef.current.delete(src);
      } catch {}
    }
    try {
      const ctx = playbackCtxRef.current;
      if (ctx) playbackTimeRef.current = ctx.currentTime;
    } catch {}
  }

  function clearHoldPlayback() {
    for (const src of Array.from(holdSourcesRef.current)) {
      try {
        src.onended = null;
        src.stop(0);
      } catch {}
      try {
        holdSourcesRef.current.delete(src);
      } catch {}
    }
  }

  async function loadVadModel() {
    if (vadModel) return;
    await waitForOrtReady();
    setState('Loading VAD…', '#7a7a7a');
    dbg('loadVadModel: creating VAD session');
    const sessionOptions = { executionProviders: ['wasm'] };
    vadModel = await ort.InferenceSession.create('../client_side_wake_word/models/silero_vad.onnx', sessionOptions);
    dbg('loadVadModel: VAD session ready');

    const vadStateShape = [2, 1, 64];
    vadState.h = new ort.Tensor('float32', new Float32Array(128).fill(0), vadStateShape);
    vadState.c = new ort.Tensor('float32', new Float32Array(128).fill(0), vadStateShape);
  }

  async function runVad(chunk) {
    try {
      const tensor = new ort.Tensor('float32', chunk, [1, chunk.length]);
      const sr = new ort.Tensor('int64', [BigInt(SAMPLE_RATE)], []);
      const res = await vadModel.run({ input: tensor, sr: sr, h: vadState.h, c: vadState.c });
      vadState.h = res.hn;
      vadState.c = res.cn;
      const p = res.output.data[0];
      return p;
    } catch {
      return 0;
    }
  }

  function recordPreRoll(chunk) {
    dgPreRollBuffer.push(new Float32Array(chunk));
    while (dgPreRollBuffer.length > DEEPGRAM_PREROLL_CHUNKS) dgPreRollBuffer.shift();
  }

  function resetDeepgramState() {
    dgUtteranceMatched = false;
    dgTranscriptFinal = '';
    dgTranscriptInterim = '';
  }

  function closeDeepgramStream() {
    if (!dgWs) return;
    if (dgCloseTimer) {
      clearTimeout(dgCloseTimer);
      dgCloseTimer = null;
    }
    try {
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(JSON.stringify({ type: 'CloseStream' }));
      }
    } catch {}
    try {
      dgWs.close();
    } catch {}
    dgWs = null;
    dgCloseRequested = false;
    dgIsOpening = false;
  }

  function requestDeepgramFinalizeAndClose() {
    if (!dgWs) return;
    if (dgCloseTimer) return;
    dgCloseRequested = true;

    try {
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(JSON.stringify({ type: 'Finalize' }));
      }
    } catch {}

    const graceMs = dgWs.readyState === WebSocket.OPEN ? 1600 : 5000;
    dgCloseTimer = setTimeout(() => {
      dgCloseTimer = null;
      closeDeepgramStream();
    }, graceMs);
  }

  async function openDeepgramStream() {
    if (dgWs || dgIsOpening) return;
    dgIsOpening = true;

    requestUiState({ label: 'Listening…', color: '#3b82f6', mode: 'mode-listening', minDwellMs: 360 });
    const wsUrl = await getBackendWsUrl('/deepgram');

    dgWs = new WebSocket(wsUrl);
    dgIsOpening = false;
    resetDeepgramState();

    try {
      if (diagDgEl) diagDgEl.textContent = 'opening';
    } catch {}

    dgPendingPreRoll = dgPreRollBuffer.slice();
    dgPendingConnectAudio = [];

    dgWs.onopen = () => {
      try {
        if (diagDgEl) diagDgEl.textContent = 'open';
      } catch {}
      // flush pre-roll
      try {
        for (const pre of dgPendingPreRoll) {
          const pcmBytes = float32ToLinear16PcmBytes(pre);
          dgWs.send(pcmBytes);
        }
      } catch {}
      dgPendingPreRoll = [];

      // flush connect audio
      try {
        for (const q of dgPendingConnectAudio) {
          const pcmBytes = float32ToLinear16PcmBytes(q);
          dgWs.send(pcmBytes);
        }
      } catch {}
      dgPendingConnectAudio = [];

      if (dgCloseRequested) {
        try {
          dgWs.send(JSON.stringify({ type: 'Finalize' }));
        } catch {}
        if (dgCloseTimer) clearTimeout(dgCloseTimer);
        dgCloseTimer = setTimeout(() => {
          dgCloseTimer = null;
          closeDeepgramStream();
        }, 1600);
      }
    };

    dgWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.type === 'proxy_open') return;
        if (msg?.type === 'error') {
          setState(`Deepgram error`, '#ef4444');
          try {
            if (diagDgEl) diagDgEl.textContent = 'error';
          } catch {}
          return;
        }

        const transcript = msg?.channel?.alternatives?.[0]?.transcript || '';
        if (typeof transcript !== 'string') return;

        try {
          const t = transcript.trim();
          if (t) {
            console.log('[deepgram]', msg?.is_final ? '[final]' : '[interim]', t);
          }
        } catch {}

        if (msg?.is_final) {
          if (transcript.trim()) {
            dgTranscriptFinal = `${dgTranscriptFinal}${dgTranscriptFinal ? '\n' : ''}${transcript.trim()}`;
          }
          dgTranscriptInterim = '';
        } else {
          dgTranscriptInterim = transcript;
        }

        const combined = `${dgTranscriptFinal}\n${dgTranscriptInterim}`;

        try {
          const c = combined.trim();
          if (c) {
            console.log('[deepgram][combined]', c);
          }
        } catch {}
        try {
          if (diagTranscriptEl) diagTranscriptEl.textContent = combined.trim();
        } catch {}

        if (!dgUtteranceMatched && keywordMatchesTranscript(keywordPhrases, combined)) {
          dgUtteranceMatched = true;
          setState('Wakeword detected', '#22c55e');
          void startAgentCall();
        }

        if (dgCloseRequested && (msg?.speech_final || msg?.is_final)) {
          closeDeepgramStream();
        }
      } catch {
        // ignore
      }
    };

    dgWs.onerror = () => {
      setState('Deepgram socket error', '#ef4444');
      try {
        if (diagDgEl) diagDgEl.textContent = 'error';
      } catch {}
    };

    dgWs.onclose = () => {
      dgWs = null;
      dgIsOpening = false;
      try {
        if (diagDgEl) diagDgEl.textContent = 'closed';
      } catch {}
    };
  }

  function sendDeepgramAudioChunk(chunk) {
    if (!dgWs) return;
    try {
      if (dgWs.readyState === WebSocket.OPEN) {
        const pcmBytes = float32ToLinear16PcmBytes(chunk);
        dgWs.send(pcmBytes);
      } else if (dgWs.readyState === WebSocket.CONNECTING) {
        dgPendingConnectAudio.push(new Float32Array(chunk));
      }
    } catch {}
  }

  async function startAgentCall() {
    if (agentIsConnected || agentIsConnecting) return;
    agentIsConnecting = true;
    requestUiState({ label: 'Connecting to agent…', color: '#a855f7', mode: 'mode-agent-connecting', minDwellMs: 360 });
    setActionButton('agent');

    const wsUrl = await getBackendWsUrl('/browser-call');
    agentWs = new WebSocket(wsUrl);

    try {
      if (diagAgentEl) diagAgentEl.textContent = 'connecting';
    } catch {}

    agentWs.onopen = async () => {
      agentIsConnecting = false;
      agentIsConnected = true;
      requestUiState({ label: 'Connected to agent', color: '#22c55e', mode: 'mode-agent-connected', minDwellMs: 360 });
      setActionButton('agent');

      try {
        if (diagAgentEl) diagAgentEl.textContent = 'connected';
      } catch {}

      try {
        agentWs.send(JSON.stringify({ event: 'start' }));
      } catch {}

      try {
        await startAgentMicStreaming();
      } catch {
        // ignore
      }

      // stop deepgram (we've handed off)
      try {
        closeDeepgramStream();
      } catch {}
    };

    agentWs.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.event === 'clear') {
          clearPlayback();
          return;
        }
        if (msg?.event === 'hold.clear') {
          clearHoldPlayback();
          return;
        }
        if (msg?.event === 'media' && msg?.media?.payload) {
          await playPcm16(msg.media.payload, 24000);
        }
      } catch {
        // ignore
      }
    };

    agentWs.onerror = () => {
      setState('Agent socket error', '#ef4444');
      try {
        if (diagAgentEl) diagAgentEl.textContent = 'error';
      } catch {}
    };

    agentWs.onclose = () => {
      try {
        if (diagAgentEl) diagAgentEl.textContent = 'disconnected';
      } catch {}
      // agent hung up OR user hung up OR server reset
      void stopAgentCallAndReturn(isRunning ? 'listening' : 'idle');
    };
  }

  async function startAgentMicStreaming() {
    // Use a second AudioContext to resample to 24kHz PCM16 like voice-direct.
    if (agentAudioCtx) return;

    agentAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const inRate = agentAudioCtx.sampleRate;
    const outRate = 24000;

    agentMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    agentSource = agentAudioCtx.createMediaStreamSource(agentMicStream);
    agentProcessor = agentAudioCtx.createScriptProcessor(2048, 1, 1);

    let floatCarry = new Float32Array(0);

    agentProcessor.onaudioprocess = (e) => {
      try {
        if (!agentWs || agentWs.readyState !== WebSocket.OPEN) return;

        const input = e.inputBuffer.getChannelData(0);
        const merged = new Float32Array(floatCarry.length + input.length);
        merged.set(floatCarry, 0);
        merged.set(input, floatCarry.length);

        const ratio = inRate / outRate;
        const usableSamples = Math.floor(merged.length / ratio);
        if (usableSamples <= 0) {
          floatCarry = merged;
          return;
        }

        const slice = new Int16Array(usableSamples);
        for (let i = 0; i < usableSamples; i++) {
          const idx = i * ratio;
          const i0 = Math.floor(idx);
          const i1 = Math.min(merged.length - 1, i0 + 1);
          const frac = idx - i0;
          const v = merged[i0] * (1 - frac) + merged[i1] * frac;
          slice[i] = clampToInt16(v * 32768);
        }

        agentWs.send(
          JSON.stringify({
            event: 'media',
            media: {
              timestamp: Date.now(),
              payload: int16ToBase64(slice),
            },
          })
        );

        const consumedAtIn = Math.floor(usableSamples * ratio);
        floatCarry = merged.subarray(consumedAtIn);
      } catch {
        // ignore
      }
    };

    agentSource.connect(agentProcessor);
    agentProcessor.connect(agentAudioCtx.destination);
  }

  async function stopAgentCallAndReturn(targetMode) {
    agentIsConnecting = false;
    agentIsConnected = false;

    try {
      if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ event: 'close' }));
      }
    } catch {}

    try {
      agentWs?.close();
    } catch {}
    agentWs = null;

    try {
      agentProcessor?.disconnect();
    } catch {}
    agentProcessor = null;

    try {
      agentSource?.disconnect();
    } catch {}
    agentSource = null;

    try {
      agentMicStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    agentMicStream = null;

    try {
      await agentAudioCtx?.close();
    } catch {}
    agentAudioCtx = null;

    try {
      clearPlayback();
      clearHoldPlayback();
    } catch {}

    if (targetMode === 'idle') {
      setActionButton('idle');
    } else {
      setActionButton('listening');
    }

    try {
      if (diagAgentEl) diagAgentEl.textContent = 'disconnected';
    } catch {}

    // return to listening/idle
    dgUtteranceMatched = false;
    dgTranscriptFinal = '';
    dgTranscriptInterim = '';
    try {
      if (diagTranscriptEl) diagTranscriptEl.textContent = '';
    } catch {}

    if (targetMode === 'idle') {
      setUiMode('mode-idle');
      setState('Idle', '#7a7a7a');
      setVADLevel(0);
    } else {
      requestUiState({ label: 'Listening…', color: '#3b82f6', mode: 'mode-listening', minDwellMs: 360 });
    }
  }

  async function startListening() {
    if (isRunning) return;
    isRunning = true;

    const token = ++startListeningToken;

    dbg('startListening: begin');

    setActionButton('listening');
    setState('Starting…', '#7a7a7a');

    // Ensure ort is loaded before attempting to load models.
    await waitForOrtReady();
    if (!isRunning || token !== startListeningToken) return;
    await loadVadModel();
    if (!isRunning || token !== startListeningToken) return;

    dbg('startListening: creating AudioContext');

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });

    const ctx = audioContext;
    if (!ctx) {
      throw new Error('AudioContext not created');
    }

    dbg('startListening: AudioContext state', ctx.state, 'sampleRate', ctx.sampleRate);

    // Some browsers require resume() during the user gesture.
    try {
      if (ctx.state === 'suspended') {
        dbg('startListening: resuming AudioContext');
        await ctx.resume();
        dbg('startListening: AudioContext resumed', ctx.state);
      }
    } catch {}

    if (!isRunning || token !== startListeningToken) {
      try {
        await ctx.close();
      } catch {}
      return;
    }

    const processorCode = `
      class AudioProcessor extends AudioWorkletProcessor {
        bufferSize = ${FRAME_SIZE};
        _buffer = new Float32Array(this.bufferSize);
        _pos = 0;
        process(inputs) {
          const input = inputs[0][0];
          if (input) {
            for (let i = 0; i < input.length; i++) {
              this._buffer[this._pos++] = input[i];
              if (this._pos === this.bufferSize) {
                this.port.postMessage(this._buffer);
                this._pos = 0;
              }
            }
          }
          return true;
        }
      }
      registerProcessor('audio-processor', AudioProcessor);
    `;

    const blob = new Blob([processorCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    dbg('startListening: addModule(AudioWorklet)');
    await ctx.audioWorklet.addModule(url);
    dbg('startListening: AudioWorklet module loaded');
    URL.revokeObjectURL(url);

    if (!isRunning || token !== startListeningToken) {
      try {
        await ctx.close();
      } catch {}
      return;
    }

    dbg('startListening: getUserMedia');
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    dbg('startListening: getUserMedia ok', { tracks: mediaStream.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, muted: t.muted })) });

    if (!isRunning || token !== startListeningToken) {
      try {
        mediaStream?.getTracks().forEach((t) => t.stop());
      } catch {}
      mediaStream = null;
      try {
        await ctx.close();
      } catch {}
      return;
    }

    const source = ctx.createMediaStreamSource(mediaStream);

    gainNode = ctx.createGain();
    gainNode.gain.value = 1;

    workletNode = new AudioWorkletNode(ctx, 'audio-processor');

    source.connect(gainNode);
    gainNode.connect(workletNode);

    workletNode.port.onmessage = async (event) => {
      const chunk = event.data;
      if (!(chunk instanceof Float32Array)) return;

      if ((workletNode.__dbg_frames || 0) < 3) {
        workletNode.__dbg_frames = (workletNode.__dbg_frames || 0) + 1;
        dbg('audio frame', { len: chunk.length, first: chunk[0] });
      }

      recordPreRoll(chunk);

      // Compute VAD probability and update UI
      const p = await runVad(chunk);
      setVADLevel(p);

      try {
        if (diagSpeechEl) diagSpeechEl.textContent = String(isSpeechActive);
      } catch {}

      const isSpeechNow = p > vadThreshold;
      if (isSpeechNow) {
        isSpeechActive = true;
        vadHangoverCounter = VAD_HANGOVER_FRAMES;
      } else if (vadHangoverCounter > 0) {
        vadHangoverCounter--;
        isSpeechActive = true;
      } else {
        isSpeechActive = false;
      }

      // Visual: user speaking (local VAD)
      setSpeakingClass('user-speaking', isSpeechActive && !agentIsConnected && !agentIsConnecting);

      try {
        if (diagSpeechEl) diagSpeechEl.textContent = String(isSpeechActive);
      } catch {}

      if (!agentIsConnected && !agentIsConnecting) {
        if (isSpeechActive) {
          // start DG stream and send audio
          await openDeepgramStream();
          if (dgWs) {
            sendDeepgramAudioChunk(chunk);
          }
          requestUiState({ label: 'Detecting keyword…', color: '#f59e0b', mode: 'mode-detecting', minDwellMs: 380 });
        } else {
          if (dgWs) {
            // speech ended
            requestDeepgramFinalizeAndClose();
          }
          if (!dgUtteranceMatched) {
            requestUiState({ label: 'Listening…', color: '#3b82f6', mode: 'mode-listening', minDwellMs: 380 });
          }
        }
      }
    };

    requestUiState({ label: 'Listening…', color: '#3b82f6', mode: 'mode-listening', minDwellMs: 360 });
    setActionButton('listening');
    dbg('startListening: ready');
  }

  function setPanelTab(which) {
    const showDiagnostics = which === 'diagnostics';
    try {
      if (tabDiagnosticsBtn) tabDiagnosticsBtn.classList.toggle('active', showDiagnostics);
      if (tabSettingsBtn) tabSettingsBtn.classList.toggle('active', !showDiagnostics);
      if (panelDiagnosticsEl) panelDiagnosticsEl.hidden = !showDiagnostics;
      if (panelSettingsEl) panelSettingsEl.hidden = showDiagnostics;
    } catch {}
  }

  function openPanel() {
    try {
      if (panelOverlayEl) panelOverlayEl.hidden = false;
      setPanelTab('diagnostics');
    } catch {}
  }

  function closePanel() {
    try {
      if (panelOverlayEl) panelOverlayEl.hidden = true;
    } catch {}
  }

  function parsePhrasesFromTextarea(text) {
    return (text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function syncSettingsUiFromState() {
    try {
      if (settingsPhrasesEl) settingsPhrasesEl.value = keywordPhrases.join('\n');
    } catch {}

    try {
      if (settingsVadThresholdEl) settingsVadThresholdEl.value = String(vadThreshold);
      if (settingsVadThresholdValueEl) settingsVadThresholdValueEl.textContent = Number(vadThreshold).toFixed(2);
    } catch {}
  }

  function stopAll() {
    isRunning = false;
    startListeningToken++;

    setSpeakingClass('user-speaking', false);
    setSpeakingClass('agent-speaking', false);

    try {
      workletNode && (workletNode.port.onmessage = null);
    } catch {}

    try {
      workletNode?.disconnect();
    } catch {}
    workletNode = null;

    try {
      gainNode?.disconnect();
    } catch {}
    gainNode = null;

    try {
      mediaStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    mediaStream = null;

    try {
      audioContext?.close();
    } catch {}
    audioContext = null;

    try {
      closeDeepgramStream();
    } catch {}

    void stopAgentCallAndReturn('idle');
  }

  actionBtn?.addEventListener('click', () => {
    dbg('action click', { uiControlMode, isRunning, agentIsConnecting, agentIsConnected });
    if (uiControlMode === 'idle') {
      try {
        actionBtn.disabled = true;
        actionBtn.textContent = 'Starting…';
      } catch {}
      void startListening().catch((e) => {
        dbgErr('startListening error', e);
        setState('Error starting', '#ef4444');
        stopAll();
      });
      return;
    }

    if (uiControlMode === 'listening') {
      stopAll();
      return;
    }

    // agent
    void stopAgentCallAndReturn('listening');
  });

  settingsToggleBtn?.addEventListener('click', () => {
    try {
      if (panelOverlayEl?.hidden) openPanel();
      else closePanel();
    } catch {}
  });

  panelCloseBtn?.addEventListener('click', () => {
    closePanel();
  });

  panelOverlayEl?.addEventListener('click', (e) => {
    if (e.target === panelOverlayEl) closePanel();
  });

  tabDiagnosticsBtn?.addEventListener('click', () => setPanelTab('diagnostics'));
  tabSettingsBtn?.addEventListener('click', () => setPanelTab('settings'));

  settingsPhrasesEl?.addEventListener('input', () => {
    try {
      const next = parsePhrasesFromTextarea(settingsPhrasesEl.value);
      if (next.length > 0) keywordPhrases = next;
    } catch {}
  });

  settingsVadThresholdEl?.addEventListener('input', () => {
    try {
      const v = Number(settingsVadThresholdEl.value);
      if (!Number.isFinite(v)) return;
      vadThreshold = Math.max(0, Math.min(1, v));
      if (settingsVadThresholdValueEl) settingsVadThresholdValueEl.textContent = vadThreshold.toFixed(2);
    } catch {}
  });

  window.addEventListener('beforeunload', () => {
    stopAll();
  });

  // initial UI
  setUiMode('mode-idle');
  setState('Idle', '#7a7a7a');
  setVADLevel(0);
  setActionButton('idle');

  try {
    if (diagDgEl) diagDgEl.textContent = 'closed';
    if (diagAgentEl) diagAgentEl.textContent = 'disconnected';
    if (diagSpeechEl) diagSpeechEl.textContent = 'false';
    if (diagTranscriptEl) diagTranscriptEl.textContent = '';
  } catch {}

  syncSettingsUiFromState();

  // Prefetch backend-url once per page load.
  void getBackendHttpUrl();
});
