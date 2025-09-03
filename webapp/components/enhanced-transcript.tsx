"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranscript } from "@/contexts/TranscriptContext";
import { ChevronRightIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import AdditionalTools from "@/components/additional-tools";

export interface EnhancedTranscriptProps {
  userText: string;
  setUserText: (val: string) => void;
  onSendMessage: () => void;
  canSend: boolean;
  inFlight?: boolean;
  onCancel?: () => void;
  onOpenCanvas?: (canvas: { url: string; title?: string }) => void;
}

export function EnhancedTranscript({
  userText,
  setUserText,
  onSendMessage,
  canSend,
  inFlight = false,
  onCancel,
  onOpenCanvas,
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
                        {title}
                      </div>
                    </div>
                  </div>
                </div>
              );
            } else if (type === "BREADCRUMB") {
              const isCanvasLink = !!(data && typeof (data as any).content === "string" && /^https?:\/\//.test((data as any).content));
              const hasTfLinks = !!(data && (data as any).url_json && (data as any).url_d2);
              return (
                <div
                  key={itemId}
                  className="flex flex-col text-gray-600 text-sm"
                >
                  <span className="text-xs font-mono text-gray-400 mb-1">{timestamp}</span>
                  {/* Canvas link style */}
                  {isCanvasLink ? (
                    <div
                      role="button"
                      tabIndex={0}
                      className="inline-flex items-center gap-2 text-sm font-mono text-blue-600 hover:text-blue-700 underline underline-offset-2 cursor-pointer"
                      onClick={() => {
                        const url = (data as any).content as string;
                        const providedTitle = (data as any).title as string | undefined;
                        if (onOpenCanvas) onOpenCanvas({ url, title: providedTitle || title });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const url = (data as any).content as string;
                          const providedTitle = (data as any).title as string | undefined;
                          if (onOpenCanvas) onOpenCanvas({ url, title: providedTitle || title });
                        }
                      }}
                    >
                      <span className="text-blue-500">📝</span>
                      {(() => {
                        const raw = ((data as any).title as string | undefined) || title || "Canvas";
                        const cleaned = raw.replace(/^([📝🔧]\s*)/, "").trim();
                        return <span>{cleaned}</span>;
                      })()}
                    </div>
                  ) : (
                    // Default breadcrumb with expandable JSON details
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
                  )}
                  {/* ThoughtFlow artifact quick links (only when expanded) */}
                  {!isCanvasLink && hasTfLinks && expanded && (
                    <div className="mt-2 ml-6 flex gap-3 flex-wrap">
                      {/* Prefer in-app viewer when session_id is present */}
                      {((data as any).session_id || (data as any).url_d2_viewer) && (
                        <a
                          href={((data as any).session_id
                            ? `/thoughtflow/viewer/${(data as any).session_id}`
                            : (data as any).url_d2_viewer) as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50"
                          title="Open D2 in browser viewer"
                        >
                          <span>Viewer</span>
                          <ChevronRightIcon className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                  {/* Default expanded JSON dump for other breadcrumbs; suppress for ThoughtFlow artifacts */}
                  {!isCanvasLink && expanded && data && !hasTfLinks && (
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

      {/* Input Area and Additional Tools */}
      <div className="flex-shrink-0 border-t border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSend && !inFlight) {
                onSendMessage();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 focus:outline-none border-0 bg-transparent"
          />
          {inFlight ? (
            <button
              onClick={() => onCancel && onCancel()}
              title="Working… Click to cancel"
              aria-label="Working… Click to cancel"
              className="bg-gray-900 text-white rounded-full px-3 py-2"
            >
              <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </button>
          ) : (
            <button
              onClick={onSendMessage}
              disabled={!canSend || !userText.trim()}
              className="bg-gray-900 text-white rounded-full px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
        <AdditionalTools />
      </div>
    </div>
  );
}
