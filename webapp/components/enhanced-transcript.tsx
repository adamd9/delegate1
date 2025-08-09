"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranscript } from "@/contexts/TranscriptContext";
import { ChevronRightIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import VoiceMiniApp from "@/components/voice-mini-app";

export interface EnhancedTranscriptProps {
  userText: string;
  setUserText: (val: string) => void;
  onSendMessage: () => void;
  canSend: boolean;
}

export function EnhancedTranscript({
  userText,
  setUserText,
  onSendMessage,
  canSend,
}: EnhancedTranscriptProps) {
  const { transcriptItems, toggleTranscriptItemExpand } = useTranscript();
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Track previous items in a ref to avoid triggering re-renders
  const prevLogsRef = useRef(transcriptItems);
  const [justCopied, setJustCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function scrollToBottom() {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }

  useEffect(() => {
    const prevLogs = prevLogsRef.current;
    const hasNewMessage = transcriptItems.length > prevLogs.length;
    const hasUpdatedMessage = transcriptItems.some((newItem, index) => {
      const oldItem = prevLogs[index];
      return (
        !!oldItem &&
        (newItem.title !== oldItem.title || newItem.data !== oldItem.data)
      );
    });

    if (hasNewMessage || hasUpdatedMessage) {
      scrollToBottom();
    }

    // Update ref without causing another render
    prevLogsRef.current = transcriptItems;
  }, [transcriptItems]);

  const handleCopyTranscript = async () => {
    const transcriptText = transcriptItems
      .filter(item => !item.isHidden)
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .map(item => {
        if (item.type === "MESSAGE") {
          const channelPrefix = item.channel ? `[${item.channel.toUpperCase()}]` : "";
          const supervisorPrefix = item.supervisor ? "[SUPERVISOR]" : "";
          return `${item.timestamp} ${channelPrefix}${supervisorPrefix} ${item.role?.toUpperCase()}: ${item.title}`;
        } else {
          return `${item.timestamp} [SYSTEM] ${item.title}`;
        }
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(transcriptText);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy transcript:", err);
    }
  };

  function renderContentWithLinks(text: string) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (/^https?:\/\/[^\s]+$/.test(part)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white rounded-t-xl">
        <span className="font-semibold">Conversation</span>
        <div className="flex gap-2">
          <button
            onClick={handleCopyTranscript}
            className="w-24 text-sm px-3 py-1 rounded-md bg-gray-200 hover:bg-gray-300 flex items-center justify-center gap-1"
          >
            <ClipboardIcon className="w-4 h-4" />
            {justCopied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Transcript Content */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-auto p-4 space-y-4 min-h-0"
      >
        {[...transcriptItems]
          .sort((a, b) => a.createdAtMs - b.createdAtMs)
          .map((item) => {
            const {
              itemId,
              type,
              role,
              title = "",
              data,
              expanded,
              timestamp,
              isHidden,
              channel,
              supervisor,
            } = item;

            if (isHidden) {
              return null;
            }

            if (type === "MESSAGE") {
              const isUser = role === "user";
              const containerClasses = `flex ${
                isUser ? "justify-end" : "justify-start"
              }`;
              
              const bubbleClasses = `max-w-lg p-3 rounded-lg ${
                isUser 
                  ? "bg-gray-900 text-white" 
                  : supervisor
                  ? "bg-purple-50 text-purple-900 border border-purple-200"
                  : "bg-gray-100 text-gray-900"
              }`;

              const channelBadge = channel && (
                <span className={`inline-block px-2 py-1 text-xs rounded-full mr-2 ${
                  channel === "voice" 
                    ? "bg-green-100 text-green-800" 
                    : "bg-gray-100 text-gray-800"
                }`}>
                  {channel}
                </span>
              );

              const supervisorBadge = supervisor && (
                <span className="inline-block px-2 py-1 text-xs rounded-full mr-2 bg-purple-100 text-purple-800">
                  supervisor
                </span>
              );

              return (
                <div key={itemId} className={containerClasses}>
                  <div className="max-w-lg">
                    <div className={bubbleClasses}>
                      <div className={`text-xs mb-1 ${
                        isUser ? "text-gray-300" : "text-gray-500"
                      } font-mono`}>
                        {timestamp}
                        {!isUser && (channelBadge || supervisorBadge)}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {renderContentWithLinks(title)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            } else if (type === "CANVAS") {
              const url = data?.url;
              return (
                <div key={itemId} className="flex justify-center">
                  <div className="bg-blue-50 text-blue-800 border border-blue-200 px-3 py-2 rounded-md text-sm">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline flex items-center gap-1"
                    >
                      <span>🖼️</span>
                      <span>{title || "Open canvas"}</span>
                    </a>
                  </div>
                </div>
              );
            } else if (type === "BREADCRUMB") {
              return (
                <div
                  key={itemId}
                  className="flex flex-col text-gray-600 text-sm"
                >
                  <span className="text-xs font-mono text-gray-400 mb-1">{timestamp}</span>
                  <div
                    className={`flex items-center font-mono text-sm ${
                      data ? "cursor-pointer hover:text-gray-800" : ""
                    }`}
                    onClick={() => data && toggleTranscriptItemExpand(itemId)}
                  >
                    {data && (
                      <ChevronRightIcon
                        className={`w-4 h-4 mr-1 transition-transform duration-200 ${
                          expanded ? "rotate-90" : "rotate-0"
                        }`}
                      />
                    )}
                    <span className="text-orange-600">🔧</span>
                    <span className="ml-2">{title}</span>
                  </div>
                  {expanded && data && (
                    <div className="mt-2 ml-6">
                      <pre className="bg-gray-50 border-l-2 border-orange-200 p-2 text-xs overflow-x-auto whitespace-pre-wrap font-mono text-gray-700">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
      </div>

      {/* Input Area and Voice Mini App */}
      <div className="flex-shrink-0 border-t border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSend) {
                onSendMessage();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 focus:outline-none border-0 bg-transparent"
          />
          <button
            onClick={onSendMessage}
            disabled={!canSend || !userText.trim()}
            className="bg-gray-900 text-white rounded-full px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
        <VoiceMiniApp />
      </div>
    </div>
  );
}
