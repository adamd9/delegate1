import { useRef, useState, useCallback } from "react";
import {
  RealtimeSession,
  RealtimeAgent,
  OpenAIRealtimeWebRTC,
} from "@openai/agents/realtime";
import { audioFormatForCodec, applyCodecPreferences } from "./codecUtils";

interface ConnectOptions {
  getEphemeralKey: () => Promise<string>;
  initialAgents: RealtimeAgent[];
  audioElement?: HTMLAudioElement;
}

export function useOpenAIRealtime() {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const [status, setStatus] = useState<
    "DISCONNECTED" | "CONNECTING" | "CONNECTED"
  >("DISCONNECTED");

  const connect = useCallback(
    async ({ getEphemeralKey, initialAgents, audioElement }: ConnectOptions) => {
      if (sessionRef.current) return;
      setStatus("CONNECTING");

      const ek = await getEphemeralKey();
      const codecParam = (
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("codec") ?? "opus"
          : "opus"
      ).toLowerCase();
      const audioFormat = audioFormatForCodec(codecParam);
      const rootAgent = initialAgents[0];

      sessionRef.current = new RealtimeSession(rootAgent, {
        transport: new OpenAIRealtimeWebRTC({
          audioElement,
          changePeerConnection: async (pc: RTCPeerConnection) => {
            applyCodecPreferences(pc, codecParam);
            return pc;
          },
        }),
        model: "gpt-4o-realtime-preview-2025-06-03",
        config: {
          inputAudioFormat: audioFormat,
          outputAudioFormat: audioFormat,
          inputAudioTranscription: {
            model: "gpt-4o-mini-transcribe",
          },
        },
      });

      await sessionRef.current.connect({ apiKey: ek });
      setStatus("CONNECTED");
    },
    []
  );

  const disconnect = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus("DISCONNECTED");
  }, []);

  const mute = useCallback((m: boolean) => {
    sessionRef.current?.mute(m);
  }, []);

  const pushToTalkStart = useCallback(() => {
    sessionRef.current?.transport.sendEvent({
      type: "input_audio_buffer.clear",
    } as any);
  }, []);

  const pushToTalkStop = useCallback(() => {
    sessionRef.current?.transport.sendEvent({
      type: "input_audio_buffer.commit",
    } as any);
    sessionRef.current?.transport.sendEvent({ type: "response.create" } as any);
  }, []);

  return {
    status,
    connect,
    disconnect,
    mute,
    pushToTalkStart,
    pushToTalkStop,
  } as const;
}
