"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, RefreshCw, Copy, ArrowLeft } from "lucide-react";

export default function CanvasViewerPage() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url") || "";
  const title = searchParams.get("title") || "Canvas Viewer";
  const [reloadKey, setReloadKey] = React.useState(0);
  const [copied, setCopied] = React.useState(false);

  const handleRefresh = () => setReloadKey((k) => k + 1);
  const handleOpenNewTab = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const canGoBack = typeof window !== "undefined" && window.history.length > 1;

  return (
    <div className="h-screen w-screen flex flex-col bg-white">
      <header className="flex items-center gap-2 px-4 py-3 border-b bg-white">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && (
            <button
              onClick={() => window.history.back()}
              aria-label="Back"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0">
            <div className="text-xs text-gray-500 leading-tight">Canvas</div>
            <div
              className="text-base font-medium leading-tight truncate"
              title={title || url}
            >
              {title || url}
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            onClick={handleOpenNewTab}
            aria-label="Open in new tab"
            disabled={!url}
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </button>
          <button
            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            onClick={handleRefresh}
            aria-label="Reload"
            disabled={!url}
          >
            <RefreshCw className="w-4 h-4" />
            Reload
          </button>
          <button
            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            onClick={handleCopyLink}
            aria-label="Copy viewer link"
          >
            <Copy className="w-4 h-4" />
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </header>

      <main className="grow bg-white">
        {url ? (
          <iframe
            key={reloadKey}
            src={url}
            title={title || "Canvas"}
            className="w-full h-full"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
            No canvas URL provided. Append ?url=... to the address.
          </div>
        )}
      </main>
    </div>
  );
}
