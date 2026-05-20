import { getAgent } from "../agentConfigs";
import { configService } from "../config";

export type ChatVoiceConfig = {
  voice: string;
  speed: number;
  ttsModel: string;
  ttsFormat: "mp3";
};

const DEFAULT_TTS_MODEL = configService.get("DELEGATE_TTS_MODEL") || "gpt-4o-mini-tts";
const DEFAULT_VOICE_SPEED = Number(configService.get("DELEGATE_CHAT_VOICE_SPEED") || "1.3");

export function getChatVoiceConfig(): ChatVoiceConfig {
  const base = getAgent("base");
  return {
    voice: base.voice || "ballad",
    speed: Number.isFinite(DEFAULT_VOICE_SPEED) ? DEFAULT_VOICE_SPEED : 1.3,
    ttsModel: DEFAULT_TTS_MODEL,
    ttsFormat: "mp3",
  };
}
