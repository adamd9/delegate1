"use client";

import React from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";

export interface CanvasData {
  url: string;
  title?: string;
}

interface CanvasPreviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvas: CanvasData | null;
}

export default function CanvasPreviewPanel({ open, onOpenChange, canvas }: CanvasPreviewPanelProps) {
  const [reloadKey, setReloadKey] = React.useState(0);

  const handleRefresh = () => setReloadKey((k) => k + 1);

  const handleOpenNewTab = () => {
    if (canvas?.url) {
      window.open(canvas.url, "_blank", "noopener,noreferrer");
    }
  };

  // Desktop panel (inline right column)
  const desktopPanel = (
    <div
      className={`hidden ${open ? "sm:flex" : "sm:hidden"} sm:flex-col sm:border-l sm:bg-white sm:w-[min(560px,40vw)] sm:max-w-[560px]`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <div className="min-w-0">
          <div className="text-sm text-gray-500 truncate">Canvas</div>
          <div className="text-base font-medium truncate" title={canvas?.title || canvas?.url}>
            {canvas?.title || canvas?.url}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            onClick={handleOpenNewTab}
            aria-label="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </button>
          <button
            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            onClick={handleRefresh}
            aria-label="Reload"
          >
            <RefreshCw className="w-4 h-4" />
            Reload
          </button>
          <button
            className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grow bg-white">
        {canvas?.url ? (
          <iframe
            key={reloadKey}
            src={canvas.url}
            title={canvas?.title || "Canvas Preview"}
            className="w-full h-full"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
            No canvas selected
          </div>
        )}
      </div>
    </div>
  );

  // Mobile full-screen overlay
  const mobileOverlay = open ? (
    <div className="sm:hidden fixed inset-0 z-40 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <div className="min-w-0">
          <div className="text-sm text-gray-500 truncate">Canvas</div>
          <div className="text-base font-medium truncate" title={canvas?.title || canvas?.url}>
            {canvas?.title || canvas?.url}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            onClick={handleOpenNewTab}
            aria-label="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </button>
          <button
            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border hover:bg-gray-50"
            onClick={handleRefresh}
            aria-label="Reload"
          >
            <RefreshCw className="w-4 h-4" />
            Reload
          </button>
          <button
            className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grow bg-white">
        {canvas?.url ? (
          <iframe
            key={reloadKey}
            src={canvas.url}
            title={canvas?.title || "Canvas Preview"}
            className="w-full h-full"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
            No canvas selected
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {desktopPanel}
      {mobileOverlay}
    </>
  );
}
