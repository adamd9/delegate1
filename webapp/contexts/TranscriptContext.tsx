"use client";

import React, {
  createContext,
  useContext,
  useState,
  FC,
  PropsWithChildren,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { TranscriptItem, TranscriptContextValue } from "@/types/transcript";

const TranscriptContext = createContext<TranscriptContextValue | undefined>(undefined);

export const TranscriptProvider: FC<PropsWithChildren> = ({ children }) => {
  const [transcriptItems, setTranscriptItems] = useState<TranscriptItem[]>([]);
  const [historyHeaderCount, setHistoryHeaderCount] = useState<number>(0);
  const [historyAnchorMs, setHistoryAnchorMs] = useState<number | null>(null);

  function newTimestampPretty(): string {
    const now = new Date();
    const time = now.toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const ms = now.getMilliseconds().toString().padStart(3, "0");
    return `${time}.${ms}`;
  }

  const addTranscriptMessage: TranscriptContextValue["addTranscriptMessage"] = (
    itemId, 
    role, 
    text = "", 
    channel = "text",
    supervisor = false,
    isHidden = false
  ) => {
    setTranscriptItems((prev) => {
      if (prev.some((log) => log.itemId === itemId && log.type === "MESSAGE")) {
        console.warn(`[addTranscriptMessage] skipping; message already exists for itemId=${itemId}, role=${role}, text=${text}`);
        return prev;
      }

      return [
        ...prev,
        {
          itemId,
          type: "MESSAGE",
          role,
          title: text,
          expanded: false,
          timestamp: newTimestampPretty(),
          createdAtMs: Date.now(),
          status: "DONE",
          isHidden,
          channel,
          supervisor,
        },
      ];
    });
  };

  const updateTranscriptMessage: TranscriptContextValue["updateTranscriptMessage"] = (itemId, newText, isDelta = false) => {
    const append = isDelta;
    setTranscriptItems((prev) =>
      prev.map((item) => {
        if (item.itemId === itemId && item.type === "MESSAGE") {
          return {
            ...item,
            title: append ? (item.title ?? "") + newText : newText,
          };
        }
        return item;
      })
    );
  };

  const addTranscriptBreadcrumb: TranscriptContextValue["addTranscriptBreadcrumb"] = (title, data, isHidden = false) => {
    // Prefer an explicit numeric timestamp in data for consistent ordering (e.g., WS replay)
    const createdAt = (() => {
      const ts = (data as any)?.timestamp;
      return typeof ts === 'number' ? ts : Date.now();
    })();
    setTranscriptItems((prev) => [
      ...prev,
      {
        itemId: `breadcrumb-${uuidv4()}`,
        type: "BREADCRUMB",
        title,
        data,
        expanded: false,
        timestamp: newTimestampPretty(),
        createdAtMs: createdAt,
        status: "DONE",
        isHidden,
      },
    ]);
  };

  const toggleTranscriptItemExpand: TranscriptContextValue["toggleTranscriptItemExpand"] = (itemId) => {
    setTranscriptItems((prev) =>
      prev.map((log) =>
        log.itemId === itemId ? { ...log, expanded: !log.expanded } : log
      )
    );
  };

  const updateTranscriptItem: TranscriptContextValue["updateTranscriptItem"] = (itemId, updatedProperties) => {
    setTranscriptItems((prev) =>
      prev.map((item) =>
        item.itemId === itemId ? { ...item, ...updatedProperties } : item
      )
    );
  };

  const clearTranscript = () => {
    setTranscriptItems([]);
  };

  return (
    <TranscriptContext.Provider
      value={{
        transcriptItems,
        historyHeaderCount,
        historyAnchorMs,
        addTranscriptMessage,
        updateTranscriptMessage,
        addTranscriptBreadcrumb,
        toggleTranscriptItemExpand,
        updateTranscriptItem,
        clearTranscript,
        setHistoryHeaderCount,
        setHistoryAnchorMs,
      }}
    >
      {children}
    </TranscriptContext.Provider>
  );
};

export const useTranscript = (): TranscriptContextValue => {
  const context = useContext(TranscriptContext);
  if (!context) {
    throw new Error("useTranscript must be used within a TranscriptProvider");
  }
  return context;
};
