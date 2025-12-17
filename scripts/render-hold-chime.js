#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_SAMPLE_RATE_HZ = 24000;
const DEFAULT_DURATION_MS = 1500;

function writeWav16Mono({ sampleRateHz, pcm16LEBuffer }) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRateHz * blockAlign;

  const dataSize = pcm16LEBuffer.length;
  const riffSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(riffSize, 4);
  header.write('WAVE', 8);

  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm16LEBuffer]);
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function generateHoldChimePcm16LEBuffer(opts) {
  const durationMs = typeof opts?.durationMs === 'number' ? opts.durationMs : DEFAULT_DURATION_MS;
  const sampleRateHz =
    typeof opts?.sampleRateHz === 'number' ? opts.sampleRateHz : DEFAULT_SAMPLE_RATE_HZ;

  const durationSeconds = durationMs / 1000;
  const samples = Math.max(1, Math.round(sampleRateHz * durationSeconds));
  const buf = Buffer.alloc(samples * 2);

  const chimeStarts = Array.isArray(opts?.chimeStarts) ? opts.chimeStarts : [0.0, 0.75];
  const partials = Array.isArray(opts?.partials)
    ? opts.partials
    : [
        { f: 660, a: 0.14 },
        { f: 990, a: 0.08 },
        { f: 1320, a: 0.05 },
      ];
  const attackS = typeof opts?.attackS === 'number' ? opts.attackS : 0.006;
  const decayS = typeof opts?.decayS === 'number' ? opts.decayS : 0.35;
  const chimeLenS = typeof opts?.chimeLenS === 'number' ? opts.chimeLenS : 0.55;
  const gain = typeof opts?.gain === 'number' ? opts.gain : 1.0;

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRateHz;

    let v = 0;
    for (const start of chimeStarts) {
      const dt = t - start;
      if (dt < 0 || dt > chimeLenS) continue;

      const attackEnv = 1 - Math.exp(-dt / Math.max(attackS, 1e-6));
      const decayEnv = Math.exp(-dt / Math.max(decayS, 1e-6));
      const env = attackEnv * decayEnv;

      for (const p of partials) {
        v += Math.sin(2 * Math.PI * p.f * t) * p.a * env;
      }
    }

    const clipped = clamp(v * gain, -1, 1);
    const int16 = (clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff) | 0;
    buf.writeInt16LE(int16, i * 2);
  }

  return buf;
}

function toNumber(x) {
  if (x === undefined || x === null) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function parseStarts(str) {
  if (!str) return undefined;
  const parts = String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => toNumber(s))
    .filter((n) => typeof n === 'number');
  return parts.length ? parts : undefined;
}

function parsePartials(str) {
  if (!str) return undefined;
  const parts = String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [fRaw, aRaw] = pair.split(':').map((x) => (x || '').trim());
      const f = toNumber(fRaw);
      const a = toNumber(aRaw);
      if (typeof f !== 'number' || typeof a !== 'number') return undefined;
      return { f, a };
    })
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function parseArgs(argv) {
  const args = {
    out: undefined,
    play: false,
    sampleRateHz: DEFAULT_SAMPLE_RATE_HZ,
    durationMs: DEFAULT_DURATION_MS,
    durationMsProvided: false,
    attackS: 0.006,
    decayS: 0.35,
    chimeLenS: 0.55,
    chimeStarts: [0.0, 0.75],
    partials: [
      { f: 660, a: 0.14 },
      { f: 990, a: 0.08 },
      { f: 1320, a: 0.05 },
    ],
    gain: 1.0,
    print: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--play') args.play = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--sample-rate') {
      const n = toNumber(argv[++i]);
      if (typeof n === 'number') args.sampleRateHz = n;
    } else if (a === '--duration-ms') {
      const n = toNumber(argv[++i]);
      if (typeof n === 'number') {
        args.durationMs = n;
        args.durationMsProvided = true;
      }
    } else if (a === '--attack-s') {
      const n = toNumber(argv[++i]);
      if (typeof n === 'number') args.attackS = n;
    } else if (a === '--decay-s') {
      const n = toNumber(argv[++i]);
      if (typeof n === 'number') args.decayS = n;
    } else if (a === '--chime-len-s') {
      const n = toNumber(argv[++i]);
      if (typeof n === 'number') args.chimeLenS = n;
    } else if (a === '--starts') {
      const next = parseStarts(argv[++i]);
      if (next) args.chimeStarts = next;
    } else if (a === '--partials') {
      const next = parsePartials(argv[++i]);
      if (next) args.partials = next;
    } else if (a === '--gain') {
      const n = toNumber(argv[++i]);
      if (typeof n === 'number') args.gain = n;
    } else if (a === '--print') args.print = true;
  }

  if (!args.durationMsProvided) {
    const maxStart = Math.max(0, ...(Array.isArray(args.chimeStarts) ? args.chimeStarts : [0]));
    const requiredMs = Math.ceil((maxStart + Math.max(0, args.chimeLenS)) * 1000);
    args.durationMs = Math.max(args.durationMs, requiredMs);
  }
  return args;
}

function main() {
  const opts = parseArgs(process.argv);
  const { out, play } = opts;
  const outPath = out
    ? path.resolve(out)
    : path.join(__dirname, 'hold-chime.wav');

  if (opts.print) {
    process.stdout.write(`${JSON.stringify({
      sampleRateHz: opts.sampleRateHz,
      durationMs: opts.durationMs,
      attackS: opts.attackS,
      decayS: opts.decayS,
      chimeLenS: opts.chimeLenS,
      chimeStarts: opts.chimeStarts,
      partials: opts.partials,
      gain: opts.gain,
    }, null, 2)}\n`);
  }

  const pcm = generateHoldChimePcm16LEBuffer(opts);
  const wav = writeWav16Mono({ sampleRateHz: opts.sampleRateHz, pcm16LEBuffer: pcm });

  fs.writeFileSync(outPath, wav);
  process.stdout.write(`Wrote WAV: ${outPath}\n`);

  if (play) {
    if (process.platform !== 'darwin') {
      process.stdout.write('Playback only implemented for macOS (darwin).\n');
      return;
    }
    execSync(`afplay ${JSON.stringify(outPath)}`, { stdio: 'inherit' });
  }
}

main();
