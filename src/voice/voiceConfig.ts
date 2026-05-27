import { getAgent } from "../agentConfigs";
import { configService } from "../config";

export type ChatVoiceConfig = {
  voice: string;
  speed: number;
  ttsModel: string;
  ttsFormat: "mp3";
};

export function getChatVoiceConfig(): ChatVoiceConfig {
  const base = getAgent("base");
  const voice = configService.get("REALTIME_VOICE") || base.voice || "ballad";
  const ttsModel = configService.get("DELEGATE_TTS_MODEL") || "gpt-4o-mini-tts";
  // Single unified voice speed. Fall back to the legacy DELEGATE_CHAT_VOICE_SPEED
  // key so existing configs keep working.
  const speedRaw = Number(
    configService.get("DELEGATE_VOICE_SPEED")
      || configService.get("DELEGATE_CHAT_VOICE_SPEED")
      || "1.1"
  );
  return {
    voice,
    speed: Number.isFinite(speedRaw) ? speedRaw : 1.1,
    ttsModel,
    ttsFormat: "mp3",
  };
}
