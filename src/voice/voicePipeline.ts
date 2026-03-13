import { extname } from "path";
import fs from "fs";
import OpenAI from "openai";
import { createOpenAIClient } from "../services/openaiClient";
import { getChatVoiceConfig } from "./voiceConfig";

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

export async function normalizeAudioForStt(inputPath: string, mime?: string, filename?: string): Promise<string> {
  const decision = resolveAudioInput(mime, filename);
  if (decision.kind !== "supported") {
    throw new VoiceMessageError(415, "unsupported_audio", "Unsupported audio type");
  }

  // Detect and decode base64-encoded audio files.
  // Some clients (e.g. ZeppOS) may embed base64 text in the multipart file part
  // instead of raw binary bytes. If detected, decode to a new file.
  const headerBuf = Buffer.alloc(256);
  const fd = fs.openSync(inputPath, "r");
  const bytesRead = fs.readSync(fd, headerBuf, 0, 256, 0);
  fs.closeSync(fd);
  const sample = headerBuf.slice(0, bytesRead);

  if (looksLikeBase64Content(sample)) {
    const raw = fs.readFileSync(inputPath, "ascii").replace(/\s+/g, "");
    const decoded = Buffer.from(raw, "base64");
    const decodedPath = inputPath + ".decoded";
    fs.writeFileSync(decodedPath, decoded);
    console.info("[voice-message] decoded base64 audio payload", {
      original_size: raw.length,
      decoded_size: decoded.length,
    });
    return decodedPath;
  }

  return inputPath;
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
