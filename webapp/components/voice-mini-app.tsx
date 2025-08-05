"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOpenAIRealtime } from "@/lib/use-openai-realtime";
import { RealtimeAgent } from "@openai/agents/realtime";

const VoiceMiniApp = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { status, connect, disconnect, mute, pushToTalkStart, pushToTalkStop } =
    useOpenAIRealtime();
  const [playbackEnabled, setPlaybackEnabled] = useState(true);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [talking, setTalking] = useState(false);

  const handleConnect = async () => {
    const agent = new RealtimeAgent({
      name: "web",
      instructions: "You are a helpful voice assistant.",
    });
    await connect({
      getEphemeralKey: async () => {
        const res = await fetch("/api/session");
        const data = await res.json();
        return data?.client_secret?.value;
      },
      initialAgents: [agent],
      audioElement: audioRef.current ?? undefined,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        {status === "CONNECTED" ? (
          <Button onClick={disconnect}>Disconnect</Button>
        ) : (
          <Button onClick={handleConnect}>Connect</Button>
        )}
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={playbackEnabled}
          onChange={(e) => {
            const enabled = e.target.checked;
            setPlaybackEnabled(enabled);
            mute(!enabled);
          }}
        />
        Audio playback
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={pushToTalk}
          onChange={(e) => setPushToTalk(e.target.checked)}
        />
        Push to talk
      </label>
      {pushToTalk && (
        <Button
          onMouseDown={() => {
            setTalking(true);
            pushToTalkStart();
          }}
          onMouseUp={() => {
            setTalking(false);
            pushToTalkStop();
          }}
          onTouchStart={() => {
            setTalking(true);
            pushToTalkStart();
          }}
          onTouchEnd={() => {
            setTalking(false);
            pushToTalkStop();
          }}
        >
          {talking ? "Talking..." : "Talk"}
        </Button>
      )}
      <audio ref={audioRef} autoPlay className="hidden" />
    </div>
  );
};

export default VoiceMiniApp;
