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
  const { transcriptItems, toggleTranscriptItemExpand, updateTranscriptItem, historyHeaderCount, historyAnchorMs } = useTranscript();
  const DEBUG = String(process.env.NEXT_PUBLIC_DEBUG_TRANSCRIPT || '').toLowerCase() === 'true';
  const [debugOpen, setDebugOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
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
          {DEBUG && (
            <button
              onClick={() => setDebugOpen((v) => !v)}
              className="w-28 text-sm px-3 py-1 rounded-md bg-orange-100 text-orange-900 hover:bg-orange-200"
              title="Toggle transcript debug view"
            >
              {debugOpen ? 'Hide debug' : 'Show debug'}
            </button>
          )}
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
        {DEBUG && debugOpen && (
          <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs text-yellow-900">transcriptItems ({transcriptItems.length})</span>
              <button
                className="text-xs px-2 py-1 rounded bg-yellow-200 text-yellow-900 hover:bg-yellow-300"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(transcriptItems, null, 2));
                  } catch {}
                }}
              >Copy JSON</button>
            </div>
            <pre className="text-xs overflow-auto max-h-64 whitespace-pre-wrap">{JSON.stringify(transcriptItems, null, 2)}</pre>
          </div>
        )}
        {(() => {
          const sorted = [...transcriptItems].sort((a, b) => a.createdAtMs - b.createdAtMs);
          const hasHeader = (historyHeaderCount || 0) > 0; // anchor not required anymore
          // Identify history items without relying on timestamps.
          const isHistoryItem = (it: typeof transcriptItems[number]) => {
            if (it.isHidden) return false; // hidden items don't affect separator placement
            if (it.itemId.startsWith('replay_')) return true;
            if (it.type === 'BREADCRUMB') {
              const d: any = (it as any).data;
              return Boolean(d && d._replay === true);
            }
            return false;
          };
          const getConversationId = (it: typeof transcriptItems[number]): string | undefined => {
            const d: any = (it as any).data;
            return d?._meta?.conversation_id as (string | undefined);
          };
          let lastHistoryIdx = -1;
          for (let i = 0; i < sorted.length; i++) {
            if (isHistoryItem(sorted[i])) lastHistoryIdx = i;
          }
          const renderList: Array<any> = [];
          let prevConversationId: string | undefined = undefined;
          for (let i = 0; i < sorted.length; i++) {
            const it = sorted[i];
            const isHist = isHistoryItem(it);
            // Insert per-run separator before a history item when the run changes
            if (hasHeader && lastHistoryIdx >= 0 && isHist) {
              const conversationId = getConversationId(it);
              if (conversationId && conversationId !== prevConversationId) {
                renderList.push({ __convsep__: true, conversationId, key: `convsep-${conversationId}-${i}` });
                prevConversationId = conversationId;
              }
            }
            renderList.push(it);
            if (hasHeader && lastHistoryIdx >= 0 && i === lastHistoryIdx) {
              // Insert the universal separator immediately after the last history item
              renderList.push({ __separator__: true, key: `sep-history` });
            }
          }
          if (hasHeader && lastHistoryIdx < 0) {
            // No history items at all; put separator at the start
            renderList.unshift({ __separator__: true, key: `sep-history` });
          }
          return renderList.map((item: any) => {
            if (item && item.__separator__) {
              return (
                <div
                  key={item.key}
                  className="flex items-center my-2 cursor-pointer select-none"
                  title="Toggle history visibility"
                  onClick={() => {
                    const next = !historyExpanded;
                    setHistoryExpanded(next);
                    try { (globalThis as any).__historyExpanded = next; } catch {}
                    for (const it of transcriptItems) {
                      const isReplay = it.itemId.startsWith('replay_');
                      const isReplayBreadcrumb = it.type === 'BREADCRUMB' && (it as any).data && (it as any).data._replay === true;
                      if (isReplay || isReplayBreadcrumb) updateTranscriptItem(it.itemId, { isHidden: !next });
                    }
                  }}
                >
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="mx-2 text-sm text-gray-700">
                    📜 Previous conversations ({historyHeaderCount})
                    <span className="ml-2 text-xs text-gray-400">{historyExpanded ? 'click to hide' : 'click to show'}</span>
                  </span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              );
            }
            if (item && item.__convsep__) {
              const short = (() => {
                const conversationId = item.conversationId as string | undefined;
                if (!conversationId) return '';
                const parts = conversationId.split('_');
                const tail = parts[parts.length - 1] || conversationId;
                if (tail && tail.length >= 4) return tail.length > 8 ? tail.slice(-8) : tail;
                return conversationId.length > 8 ? conversationId.slice(-8) : conversationId;
              })();
              return (
                <div key={item.key} className="flex items-center my-1">
                  <div className="w-20 h-px bg-gray-100 mr-2" />
                  <span className="text-[11px] text-gray-500 font-mono">Conversation {short}</span>
                  <div className="flex-1 h-px bg-gray-100 ml-2" />
                </div>
              );
            }
            const current = item as typeof transcriptItems[number];
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
            } = current;
            
            if (isHidden) return null;
            
            // Existing render branches follow
            if (type === "MESSAGE") {
              const isUser = role === "user";
              const isHistory = itemId.startsWith('replay_');
              const containerClasses = `flex ${isUser ? "justify-end" : "justify-start"}`;
              const bubbleClasses = `max-w-lg p-3 rounded-lg ${
                isUser
                  ? (isHistory ? "bg-gray-800 text-white opacity-85" : "bg-gray-900 text-white")
                  : supervisor
                  ? (isHistory ? "bg-purple-50 text-purple-900 border border-purple-200 opacity-85" : "bg-purple-50 text-purple-900 border border-purple-200")
                  : (isHistory ? "bg-gray-50 text-gray-700 border border-gray-200" : "bg-gray-100 text-gray-900")
              }`;
              const channelBadge = channel && (
                <span className={`inline-block px-2 py-1 text-xs rounded-full mr-2 ${
                  channel === "voice" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                }`}>{channel}</span>
              );
              const supervisorBadge = supervisor && (
                <span className="inline-block px-2 py-1 text-xs rounded-full mr-2 bg-purple-100 text-purple-800">supervisor</span>
              );
              return (
                <div key={itemId} className={containerClasses}>
                  <div className="max-w-lg">
                    <div className={bubbleClasses}>
                      <div className={`text-xs mb-1 ${isUser ? "text-gray-300" : "text-gray-500"} font-mono`}>
                        {timestamp}
                        {!isUser && (channelBadge || supervisorBadge)}
                        {isHistory && (
                          <span className="inline-block ml-2 px-2 py-0.5 text-[10px] rounded-full bg-gray-200 text-gray-700 align-middle">history</span>
                        )}
                        {/* Conversation badge (history items) */}
                        {(() => {
                          const conversationId: string | undefined = (data as any)?._meta?.conversation_id;
                          if (!conversationId) return null;
                          const short = (() => {
                            const parts = conversationId.split('_');
                            const tail = parts[parts.length - 1] || conversationId;
                            if (tail && tail.length >= 4) return tail.length > 8 ? tail.slice(-8) : tail;
                            return conversationId.length > 8 ? conversationId.slice(-8) : conversationId;
                          })();
                          return (
                            <span className="inline-block ml-2 px-2 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-800 align-middle" title={`conversation: ${conversationId}`}>
                              conv:{short}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="whitespace-pre-wrap">{title}</div>
                      {DEBUG && (
                        <div className="mt-2 text-[10px] font-mono text-gray-400">
                          {(() => {
                            const meta = (data && (data as any)._meta) || {};
                            const callId = (data as any)?.call_id;
                            const parts: string[] = [];
                            parts.push(`ui.id=${itemId}`);
                            parts.push(`ts=${current.createdAtMs}`);
                            if (meta.session_id) parts.push(`session=${meta.session_id}`);
                            if (meta.conversation_id) parts.push(`run=${meta.conversation_id}`);
                            if (meta.source) parts.push(`src=${meta.source}`);
                            if (meta.step_id) parts.push(`step=${meta.step_id}`);
                            if (callId) parts.push(`call=${callId}`);
                            return parts.join(' • ');
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            } else if (type === "BREADCRUMB") {
              const isHistoryHeader = typeof title === 'string' && title.startsWith("📜 Previous conversations");
              const isCanvasLink = !!(data && typeof (data as any).content === "string" && /^https?:\/\//.test((data as any).content));
              const hasTfLinks = !!(data && (data as any).url_json && (data as any).url_d2);
              return (
                <div key={itemId} className="flex flex-col text-gray-600 text-sm">
                  <span className="text-xs font-mono text-gray-400 mb-1">
                    {timestamp}
                    {/* Conversation badge for breadcrumb if present */}
                    {(() => {
                      const conversationId: string | undefined = (data as any)?._meta?.conversation_id;
                      if (!conversationId) return null;
                      const short = (() => {
                        const parts = conversationId.split('_');
                        const tail = parts[parts.length - 1] || conversationId;
                        if (tail && tail.length >= 4) return tail.length > 8 ? tail.slice(-8) : tail;
                        return conversationId.length > 8 ? conversationId.slice(-8) : conversationId;
                      })();
                      return (
                        <span className="inline-block ml-2 px-2 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-800 align-middle" title={`conversation: ${conversationId}`}>
                          conv:{short}
                        </span>
                      );
                    })()}
                  </span>
                  {isCanvasLink ? (
                    <div className="flex items-center gap-3">
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
                      {(() => {
                        const url = (data as any).content as string;
                        const providedTitle = (data as any).title as string | undefined;
                        const t = encodeURIComponent((providedTitle || title || "Canvas") as string);
                        const u = encodeURIComponent(url || "");
                        const viewerHref = `/canvas/viewer?url=${u}&title=${t}`;
                        return (
                          <a href={viewerHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 text-xs" title="Open in Viewer">Viewer</a>
                        );
                      })()}
                    </div>
                  ) : (
                    <div
                      className={`flex items-center font-mono text-sm ${(data || isHistoryHeader) ? "cursor-pointer hover:text-gray-800" : ""}`}
                      onClick={() => {
                        if (isHistoryHeader) {
                          const next = !historyExpanded;
                          setHistoryExpanded(next);
                          try { (globalThis as any).__historyExpanded = next; } catch {}
                          for (const it of transcriptItems) {
                            const isReplay = it.itemId.startsWith('replay_');
                            const isReplayBreadcrumb = it.type === 'BREADCRUMB' && (it as any).data && (it as any).data._replay === true;
                            if (isReplay || isReplayBreadcrumb) updateTranscriptItem(it.itemId, { isHidden: !next });
                          }
                        } else if (data) {
                          toggleTranscriptItemExpand(itemId);
                        }
                      }}
                    >
                      {(data || isHistoryHeader) && (
                        <ChevronRightIcon className={`w-4 h-4 mr-1 transition-transform duration-200 ${(expanded || historyExpanded && isHistoryHeader) ? "rotate-90" : "rotate-0"}`} />
                      )}
                      <span className="text-orange-600">🔧</span>
                      <span className="ml-2">{title}</span>
                    </div>
                  )}
                  {!isCanvasLink && hasTfLinks && expanded && (
                    <div className="mt-2 ml-6 flex gap-3 flex-wrap">
                      {(() => {
                        const d: any = data as any;
                        const direct = d?.url_d2_viewer as string | undefined;
                        const sid = d?.session_id as string | undefined;
                        const cid = d?.conversation_id as string | undefined;
                        const derived = sid && cid ? `/thoughtflow/viewer/${sid}.${cid}` : undefined;
                        const viewerHref = direct || derived;
                        return viewerHref ? (
                          <a href={viewerHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50" title="Open D2 in browser viewer">
                            <span>Viewer</span>
                            <ChevronRightIcon className="w-3 h-3" />
                          </a>
                        ) : null;
                      })()}
                    </div>
                  )}
                  {!isCanvasLink && expanded && data && !hasTfLinks && (
                    <div className="mt-2 ml-6">
                      <pre className="bg-gray-50 border-l-2 border-orange-200 p-2 text-xs overflow-x-auto whitespace-pre-wrap font-mono text-gray-700">{JSON.stringify(data, null, 2)}</pre>
                    </div>
                  )}
                  {DEBUG && (
                    <div className="mt-1 ml-6 text-[10px] font-mono text-gray-400">
                      {(() => {
                        const meta = (data && (data as any)._meta) || {};
                        const callId = (data as any)?.call_id;
                        const parts: string[] = [];
                        parts.push(`ui.id=${itemId}`);
                        parts.push(`ts=${current.createdAtMs}`);
                        if (meta.session_id) parts.push(`session=${meta.session_id}`);
                        if (meta.conversation_id) parts.push(`conversation=${meta.conversation_id}`);
                        if (meta.source) parts.push(`src=${meta.source}`);
                        if (meta.step_id) parts.push(`step=${meta.step_id}`);
                        if (callId) parts.push(`call=${callId}`);
                        return parts.join(' • ');
                      })()}
                    </div>
                  )}
                </div>
              );
            }
            return null;
          });
        })()}
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
