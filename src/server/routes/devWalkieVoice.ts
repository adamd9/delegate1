/**
 * TEMPORARY: JSON-based voice message endpoint for ZeppOS walkie-talkie development.
 * 
 * Route: POST /_dev/walkie/voice
 * 
 * Accepts audio as base64 in a JSON body (avoids multipart/form-data issues
 * from the ZeppOS Side Service fetch() API which only supports string bodies).
 * 
 * To be removed once walkie-talkie is stable, or promoted to a permanent
 * endpoint if it proves useful.
 */
import type { Application, Request, Response } from "express";
import fs from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  normalizeAudioForStt,
  transcribeAudio,
  synthesizeSpeech,
  VoiceMessageError,
  getMaxAudioBytes,
} from "../../voice/voicePipeline";
import { handleTextChatMessage } from "../../session/chat";
import { session } from "../../session/state";
import { createOpenAIClient } from "../../services/openaiClient";
import { chatClients, logsClients } from "../../ws/clients";

export function registerDevWalkieVoiceRoutes(app: Application) {
  app.post("/_dev/walkie/voice", async (req: Request, res: Response) => {
    const totalStart = Date.now();
    let tempPath: string | undefined;
    let normalizedPath: string | undefined;

    try {
      const { audio_base64, audio_format, audio_name, conversation_id, response_format } = req.body || {};
      // response_format: "text" (default) = text only, "audio" = include TTS mp3
      const wantAudio = response_format === "audio";

      if (!audio_base64 || typeof audio_base64 !== "string") {
        return res.status(400).json({ error: "missing_audio", message: "Missing audio_base64 field" });
      }

      // Decode base64 to buffer
      const audioBuffer = Buffer.from(audio_base64, "base64");
      const maxBytes = getMaxAudioBytes();
      if (audioBuffer.length > maxBytes) {
        return res.status(413).json({ error: "audio_too_large", message: `Audio exceeds ${maxBytes} bytes` });
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      console.log(`[_dev/walkie/voice] Received ${audioBuffer.length} bytes (${audio_format || "opus"}) at ${ts}`);

      // Save timestamped debug files
      const debugDir = join(__dirname, "../../../../zeppos-walkie-talkie-v2/debug-audio");
      try { fs.mkdirSync(debugDir, { recursive: true }); } catch {}

      const rawPath = join(debugDir, `${ts}_raw.opus`);
      fs.writeFileSync(rawPath, audioBuffer);

      // Decode to WAV for STT
      const ext = ".opus";
      const filename = `walkie_${Date.now()}${ext}`;
      tempPath = join(tmpdir(), filename);
      fs.writeFileSync(tempPath, audioBuffer);

      normalizedPath = await normalizeAudioForStt(tempPath, `audio/${audio_format || "opus"}`, audio_name);

      // Save decoded WAV for debugging
      const wavPath = join(debugDir, `${ts}_decoded.wav`);
      fs.copyFileSync(normalizedPath, wavPath);
      console.log(`[_dev/walkie/voice] Decoded WAV: ${fs.statSync(wavPath).size} bytes`);

      // STT
      const openaiClient = session.openaiClient || createOpenAIClient();
      session.openaiClient = openaiClient;

      const sttStart = Date.now();
      const transcript = await transcribeAudio(normalizedPath, openaiClient);
      const sttMs = Date.now() - sttStart;
      console.log(`[_dev/walkie/voice] STT: ${sttMs}ms, text="${transcript.text.slice(0, 80)}"`);

      if (!transcript.text || transcript.text.trim().length === 0) {
        return res.json({
          conversation_id: conversation_id || null,
          user_text: "",
          assistant_text: "",
          assistant_audio: null,
          timings_ms: { stt: sttMs, llm: 0, tts: 0, total: Date.now() - totalStart },
        });
      }

      // LLM
      const llmStart = Date.now();
      const chatResult = await handleTextChatMessage(
        transcript.text,
        chatClients,
        logsClients,
        "voice",
        {},
        { conversationId: conversation_id || undefined }
      );
      const llmMs = Date.now() - llmStart;

      if (!chatResult?.assistantText) {
        throw new Error("Assistant response was empty");
      }
      console.log(`[_dev/walkie/voice] LLM: ${llmMs}ms, reply="${chatResult.assistantText.slice(0, 80)}"`);

      // TTS (only if client wants audio back)
      let ttsMs = 0;
      let ttsBase64: string | null = null;
      if (wantAudio) {
        const ttsStart = Date.now();
        const ttsBuffer = await synthesizeSpeech(chatResult.assistantText, openaiClient);
        ttsMs = Date.now() - ttsStart;
        ttsBase64 = ttsBuffer.toString("base64");
        console.log(`[_dev/walkie/voice] TTS: ${ttsMs}ms, ${ttsBuffer.length} bytes`);
      }

      const totalMs = Date.now() - totalStart;
      console.log(`[_dev/walkie/voice] Total: ${totalMs}ms (audio=${wantAudio})`);

      res.json({
        conversation_id: chatResult.conversationId,
        user_text: transcript.text,
        assistant_text: chatResult.assistantText,
        assistant_audio: ttsBase64 ? { format: "mp3", base64: ttsBase64 } : null,
        timings_ms: { stt: sttMs, llm: llmMs, tts: ttsMs, total: totalMs },
      });

    } catch (err: any) {
      const elapsed = Date.now() - totalStart;
      console.error("[_dev/walkie/voice] Error:", err?.message || err);

      if (err instanceof VoiceMessageError) {
        return res.status(err.status).json({
          error: err.code,
          message: err.message,
        });
      }

      res.status(500).json({
        error: "server_error",
        message: err?.message || "Internal error",
        elapsed_ms: elapsed,
      });
    }
  });

  console.log("[_dev/walkie] Voice JSON route registered at POST /_dev/walkie/voice");
}
