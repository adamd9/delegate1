import type { Application, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";
import {
  normalizeAudioForStt,
  parseEndConversation,
  requireAudioFile,
  resolveAudioInput,
  synthesizeSpeech,
  transcribeAudio,
  VoiceMessageError,
  getMaxAudioBytes,
} from "../../voice/voicePipeline";
import { handleTextChatMessage } from "../../session/chat";
import { session } from "../../session/state";
import { createOpenAIClient } from "../../services/openaiClient";
import { chatClients, logsClients } from "../../ws/clients";
import { appendEvent } from "../../observability/thoughtflow";
import { completeConversation } from "../../db/sqlite";

type UploadRequest = Request & { uploadDir?: string };

function parseMeta(raw: any) {
  if (!raw) return undefined;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return undefined;
  }
}

function sanitizeRequestHeaders(headers: Request["headers"]) {
  const out: Record<string, string> = {};
  const contentType = headers["content-type"];
  const contentLength = headers["content-length"];
  const userAgent = headers["user-agent"];
  if (typeof contentType === "string") out["content-type"] = contentType;
  if (typeof contentLength === "string") out["content-length"] = contentLength;
  if (typeof userAgent === "string") out["user-agent"] = userAgent;

  for (const [key, value] of Object.entries(headers)) {
    if (!key.toLowerCase().startsWith("x-")) continue;
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

function bytesToHex(buf: Buffer, length: number) {
  return buf.slice(0, length).toString("hex");
}

function bytesToAscii(buf: Buffer, length: number) {
  const slice = buf.slice(0, length);
  let out = "";
  for (const byte of slice) {
    out += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
  }
  return out;
}

function looksLikeBase64(sample: string): boolean {
  const compact = sample.replace(/\s+/g, "");
  if (!compact) return false;
  if (compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(compact);
}

function detectMagic(buf: Buffer): string {
  if (buf.length < 4) return "unknown";
  const hex4 = buf.slice(0, 4).toString("hex");
  const ascii4 = buf.slice(0, 4).toString("ascii");
  if (ascii4 === "OggS") return "OggS";
  if (ascii4 === "RIFF") return "RIFF";
  if (ascii4 === "ID3") return "ID3";
  if (ascii4 === "fLaC") return "fLaC";
  if (hex4 === "1a45dfa3") return "EBML";
  if (buf.length >= 12) {
    const box = buf.slice(4, 8).toString("ascii");
    if (box === "ftyp") return "ftyp";
  }
  return "unknown";
}

function extractOpenAiRequestId(err: any): string | undefined {
  return (
    err?.request_id ||
    err?.response?.headers?.get?.("x-request-id") ||
    err?.headers?.["x-request-id"] ||
    err?.response?.headers?.["x-request-id"]
  );
}

function getUpstreamStatus(err: any): number | undefined {
  return err?.status || err?.response?.status || err?.response?.statusCode;
}

function getUpstreamMessage(err: any): string | undefined {
  const msg =
    err?.message ||
    err?.response?.data?.error?.message ||
    err?.response?.error?.message ||
    err?.response?.body?.error?.message;
  return typeof msg === "string" && msg.trim() ? msg : undefined;
}

function logUpstreamError(err: any, meta?: any) {
  const upstream = {
    status: getUpstreamStatus(err),
    request_id: extractOpenAiRequestId(err),
    message: getUpstreamMessage(err),
    type: err?.type || err?.name,
    code: err?.code,
  };
  try {
    console.error("[voice-message] OpenAI error", {
      upstream,
      meta,
      stack: err?.stack,
    });
  } catch {}
  try {
    const responseBody =
      err?.response?.data ||
      err?.response?.body ||
      err?.response?.error ||
      err?.error;
    if (responseBody) {
      console.error("[voice-message] OpenAI error body", responseBody);
    }
  } catch {}
}

function isOpenAiError(err: any): boolean {
  if (!err) return false;
  if (err?.name === "OpenAIError") return true;
  if (typeof err?.status === "number") return true;
  if (err?.request_id) return true;
  return false;
}

function finalizeConversation(conversationId: string) {
  const endedAt = new Date().toISOString();
  completeConversation({ id: conversationId, status: "completed", ended_at: endedAt });
  appendEvent({ type: "conversation.completed", conversation_id: conversationId, ended_at: endedAt, status: "completed" });
  try {
    if ((session as any).currentConversationId === conversationId) {
      (session as any).currentConversationId = undefined;
    }
    (session as any).lastAssistantStepId = undefined;
  } catch {}
}

export function registerVoiceMessageRoutes(app: Application) {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = (req as UploadRequest).uploadDir || tmpdir();
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safeName = basename(file.originalname || `audio_${Date.now()}`);
      cb(null, `${Date.now()}_${safeName}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: getMaxAudioBytes() },
    fileFilter: (_req, file, cb) => {
      const decision = resolveAudioInput(file.mimetype, file.originalname);
      if (decision.kind === "unsupported") {
        return cb(new VoiceMessageError(415, "unsupported_audio", "Unsupported audio type"));
      }
      cb(null, true);
    },
  });

  app.post("/api/voice/message", async (req: Request, res: Response) => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), "delegate1-voice-"));
    (req as UploadRequest).uploadDir = tempDir;

    let normalizedPath: string | undefined;
    let inputPath: string | undefined;

    try {
      const reqHeaders = sanitizeRequestHeaders(req.headers);
      try {
        console.info("[voice-message] request headers", reqHeaders);
      } catch {}

      await new Promise<void>((resolve, reject) => {
        upload.single("audio")(req, res, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });

      const file = requireAudioFile((req as any).file as Express.Multer.File | undefined) as Express.Multer.File;
      inputPath = file.path;

      try {
        const fd = fs.openSync(inputPath, "r");
        const buf = Buffer.alloc(64);
        const bytesRead = fs.readSync(fd, buf, 0, 64, 0);
        fs.closeSync(fd);
        const sample = buf.slice(0, bytesRead);
        const asciiPrefix = bytesToAscii(sample, 32);
        const hexPrefix = bytesToHex(sample, 16);
        const payloadInfo = {
          filename: file.originalname,
          part_content_type: file.mimetype,
          part_content_length: file.size,
          part_transfer_encoding: file.encoding || undefined,
          raw_size_bytes: file.size,
          hex_prefix: hexPrefix,
          ascii_prefix: asciiPrefix,
          looks_base64: looksLikeBase64(asciiPrefix),
          magic: detectMagic(sample),
        };
        console.info("[voice-message] multipart audio metadata", payloadInfo);
      } catch (e: any) {
        console.warn("[voice-message] failed to inspect audio payload", e?.message || e);
      }

      const meta = parseMeta((req.body as any)?.meta);
      const conversationId = ((req.body as any)?.conversation_id || "").toString() || undefined;
      const endConversation = parseEndConversation((req.body as any)?.end_conversation);
      const totalStart = Date.now();

      const openaiClient = session.openaiClient || createOpenAIClient();
      session.openaiClient = openaiClient;

      const sttStart = Date.now();
      normalizedPath = await normalizeAudioForStt(file.path, file.mimetype, file.originalname);
      const transcript = await transcribeAudio(normalizedPath, openaiClient);
      const sttMs = Date.now() - sttStart;
      console.info("[voice-message] stt", { ms: sttMs, text_len: transcript.text.length, meta });

      const llmStart = Date.now();
      const chatResult = await handleTextChatMessage(
        transcript.text,
        chatClients,
        logsClients,
        "voice",
        {},
        { conversationId }
      );
      const llmMs = Date.now() - llmStart;
      console.info("[voice-message] llm", { ms: llmMs, conversation_id: chatResult?.conversationId, meta });

      if (!chatResult?.assistantText) {
        throw new Error("Assistant response was empty");
      }

      const ttsStart = Date.now();
      const audioBuffer = await synthesizeSpeech(chatResult.assistantText, openaiClient);
      const ttsMs = Date.now() - ttsStart;
      console.info("[voice-message] tts", { ms: ttsMs, bytes: audioBuffer.length, meta });

      if (endConversation && chatResult.conversationId) {
        finalizeConversation(chatResult.conversationId);
      }

      const totalMs = Date.now() - totalStart;
      console.info("[voice-message] total", { ms: totalMs, conversation_id: chatResult.conversationId, meta });

      res.json({
        conversation_id: chatResult.conversationId,
        user_text: transcript.text,
        assistant_text: chatResult.assistantText,
        assistant_audio: {
          format: "mp3",
          base64: audioBuffer.toString("base64"),
        },
        timings_ms: { stt: sttMs, llm: llmMs, tts: ttsMs, total: totalMs },
      });
    } catch (err: any) {
      if (err?.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "audio_too_large", message: "Audio file exceeds size limit" });
      } else if (err instanceof VoiceMessageError) {
        res.status(err.status).json({ error: err.code, message: err.message });
      } else if (isOpenAiError(err)) {
        logUpstreamError(err, { stage: "voice-message", path: "/api/voice/message" });
        res.status(502).json({
          error: "openai_upstream_error",
          message: getUpstreamMessage(err) || "OpenAI request failed",
          request_id: extractOpenAiRequestId(err),
          upstream_status: getUpstreamStatus(err),
        });
      } else {
        res.status(500).json({ error: "server_error", message: err?.message || "Failed to process voice message" });
      }
    } finally {
      try {
        if (normalizedPath && normalizedPath !== inputPath) {
          fs.unlinkSync(normalizedPath);
        }
      } catch {}
      try {
        if (inputPath) fs.unlinkSync(inputPath);
      } catch {}
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });
}
