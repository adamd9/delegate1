import { extname } from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import OpenAI from "openai";
import { createOpenAIClient } from "../services/openaiClient";
import { getChatVoiceConfig } from "./voiceConfig";

// ffmpeg-static provides a bundled ffmpeg binary path
let ffmpegPath: string | null = null;
try {
  ffmpegPath = require("ffmpeg-static");
} catch {
  // ffmpeg-static not installed — transcoding unavailable
}

export class VoiceMessageError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type AudioInputDecision = {
  kind: "supported" | "unsupported";
  ext: string;
  mime: string;
};

const STT_DIRECT_EXTS = new Set([
  ".mp3",
  ".mp4",
  ".m4a",
  ".wav",
  ".webm",
  ".ogg",
  ".opus",
  ".mpeg",
  ".mpga",
]);

const STT_DIRECT_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/webm",
  "audio/ogg",
  "audio/opus",
  "audio/mpga",
]);

export function getMaxAudioBytes(): number {
  const raw = process.env.DELEGATE_MAX_AUDIO_BYTES || "2097152";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2097152;
  return parsed;
}

export function validateAudioFileSize(size: number, maxBytes: number) {
  if (size > maxBytes) {
    throw new VoiceMessageError(413, "audio_too_large", "Audio file exceeds size limit");
  }
}

export function requireAudioFile(file?: { size?: number }) {
  if (!file) {
    throw new VoiceMessageError(400, "missing_audio", "Missing audio file");
  }
  const maxBytes = getMaxAudioBytes();
  if (typeof file.size === "number") {
    validateAudioFileSize(file.size, maxBytes);
  }
  return file;
}

export function parseEndConversation(value: any): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return false;
}

export function resolveAudioInput(mime?: string, filename?: string): AudioInputDecision {
  const ext = (filename ? extname(filename).toLowerCase() : "") || "";
  const cleanMime = (mime || "").toLowerCase().split(";")[0].trim();
  if (STT_DIRECT_MIMES.has(cleanMime) || (ext && STT_DIRECT_EXTS.has(ext))) {
    return { kind: "supported", ext, mime: cleanMime };
  }
  return { kind: "unsupported", ext, mime: cleanMime };
}

function looksLikeBase64Content(buf: Buffer): boolean {
  if (buf.length < 16) return false;
  const sample = buf.slice(0, Math.min(buf.length, 256)).toString("ascii").replace(/\s+/g, "");
  if (sample.length < 16 || sample.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(sample);
}

const KNOWN_MAGIC: Array<{ test: (buf: Buffer) => boolean; label: string }> = [
  { test: (b) => b.slice(0, 4).toString("ascii") === "OggS", label: "OggS" },
  { test: (b) => b.slice(0, 4).toString("ascii") === "RIFF", label: "RIFF" },
  { test: (b) => b.slice(0, 3).toString("ascii") === "ID3", label: "ID3" },
  { test: (b) => b.slice(0, 4).toString("ascii") === "fLaC", label: "fLaC" },
  { test: (b) => b.slice(0, 4).toString("hex") === "1a45dfa3", label: "EBML" },
  { test: (b) => b.length >= 8 && b.slice(4, 8).toString("ascii") === "ftyp", label: "ftyp" },
  { test: (b) => (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), label: "MP3sync" },
];

function hasKnownMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return KNOWN_MAGIC.some((m) => m.test(buf));
}

function detectMagicLabel(buf: Buffer): string {
  if (buf.length < 4) return "unknown";
  for (const m of KNOWN_MAGIC) {
    if (m.test(buf)) return m.label;
  }
  return "unknown";
}

function transcodeToWav(inputPath: string): string {
  if (!ffmpegPath) {
    throw new VoiceMessageError(415, "unsupported_audio",
      "Audio format not recognized and ffmpeg is not available for transcoding");
  }
  const outputPath = inputPath + ".wav";
  try {
    execFileSync(ffmpegPath, [
      "-y", "-i", inputPath,
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
      "-f", "wav", outputPath,
    ], { timeout: 15000, stdio: "pipe" });
    const stat = fs.statSync(outputPath);
    console.info("[voice-message] transcoded to WAV", {
      input: inputPath,
      output_size: stat.size,
    });
    return outputPath;
  } catch (err: any) {
    console.error("[voice-message] ffmpeg transcode failed", err?.stderr?.toString() || err?.message);
    // Clean up partial output
    try { fs.unlinkSync(outputPath); } catch {}
    throw new VoiceMessageError(415, "unsupported_audio",
      "Audio format not recognized and transcoding failed");
  }
}

export async function normalizeAudioForStt(inputPath: string, mime?: string, filename?: string): Promise<string> {
  const decision = resolveAudioInput(mime, filename);
  if (decision.kind !== "supported") {
    throw new VoiceMessageError(415, "unsupported_audio", "Unsupported audio type");
  }

  // Read file header for format detection
  const headerBuf = Buffer.alloc(256);
  const fd = fs.openSync(inputPath, "r");
  const bytesRead = fs.readSync(fd, headerBuf, 0, 256, 0);
  fs.closeSync(fd);
  const sample = headerBuf.slice(0, bytesRead);

  // Detect and decode base64-encoded audio files.
  if (looksLikeBase64Content(sample)) {
    const raw = fs.readFileSync(inputPath, "ascii").replace(/\s+/g, "");
    const decoded = Buffer.from(raw, "base64");
    const decodedPath = inputPath + ".decoded";
    fs.writeFileSync(decodedPath, decoded);
    console.info("[voice-message] decoded base64 audio payload", {
      original_size: raw.length,
      decoded_size: decoded.length,
    });
    // Re-check the decoded content's magic bytes
    const decodedSample = decoded.slice(0, Math.min(decoded.length, 16));
    if (hasKnownMagic(decodedSample)) {
      return decodedPath;
    }
    // Decoded content also has unknown format — transcode it
    console.info("[voice-message] decoded audio has unknown format, transcoding", {
      magic: decodedSample.slice(0, 4).toString("hex"),
    });
    const wavPath = transcodeToWav(decodedPath);
    try { fs.unlinkSync(decodedPath); } catch {}
    return wavPath;
  }

  // If file has a recognized audio magic header, use it directly
  if (hasKnownMagic(sample)) {
    return inputPath;
  }

  // Unknown format (e.g. ZeppOS proprietary Opus) — transcode to WAV via ffmpeg
  const magic = detectMagicLabel(sample);
  console.info("[voice-message] unknown audio format, transcoding to WAV", {
    magic,
    hex_prefix: sample.slice(0, 16).toString("hex"),
    mime,
    filename,
  });
  return transcodeToWav(inputPath);
}

export async function transcribeAudio(pathForStt: string, openaiClient?: OpenAI) {
  const client = openaiClient || createOpenAIClient();
  const resp = await client.audio.transcriptions.create({
    model: "whisper-1",
    file: fs.createReadStream(pathForStt),
    response_format: "json",
  });
  return {
    text: (resp as any)?.text || "",
    language: (resp as any)?.language,
    duration: (resp as any)?.duration,
  };
}

export async function synthesizeSpeech(text: string, openaiClient?: OpenAI): Promise<Buffer> {
  const client = openaiClient || createOpenAIClient();
  const voiceConfig = getChatVoiceConfig();
  const resp = await client.audio.speech.create({
    model: voiceConfig.ttsModel,
    voice: voiceConfig.voice,
    input: text,
    response_format: voiceConfig.ttsFormat,
    speed: voiceConfig.speed,
  });
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
