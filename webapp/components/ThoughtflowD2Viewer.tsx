"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getBackendUrl } from "@/lib/get-backend-url";

type Props = {
  id: string;
  baseUrl?: string; // e.g., http://localhost:8081; defaults from env or sensible fallback
};

export default function ThoughtflowD2Viewer({ id, baseUrl }: Props) {
  const [sketch, setSketch] = useState(false);
  const [dark, setDark] = useState(false);
  const [scale, setScale] = useState(0.6); // 60%
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);

  const effectiveBase = useMemo(() => {
    return baseUrl || getBackendUrl();
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      if (svgRef.current) svgRef.current.innerHTML = "";
      try {
        const mod = await import(
          /* webpackIgnore: true */
          "https://cdn.jsdelivr.net/npm/@terrastruct/d2@0.1.33/+esm"
        );
        const D2 = mod.D2 as any;
        if (!D2) throw new Error("Failed to load D2 module");
        const d2 = new D2();
        const src = await fetch(`${effectiveBase}/thoughtflow/raw/${id}.d2`, {
          cache: "no-store",
        });
        if (!src.ok) throw new Error("Failed to load D2 source");
        const text = await src.text();
        const result = await d2.compile(text, {
          sketch,
          theme: dark ? "200" : "0",
        });
        const svg = await d2.render(result.diagram, result.renderOptions);
        if (!cancelled && svgRef.current) {
          svgRef.current.innerHTML = svg;
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, effectiveBase, sketch, dark]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 border-b px-3 py-2">
        <strong>ThoughtFlow D2 Viewer</strong>
        <span className="text-gray-400">•</span>
        <span className="text-gray-500">{id}.d2</span>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-2 text-sm">
          <span>Scale</span>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
          />
          <span className="w-10 text-right">{Math.round(scale * 100)}%</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sketch}
            onChange={(e) => setSketch(e.target.checked)}
          />
          Sketch
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dark}
            onChange={(e) => setDark(e.target.checked)}
          />
          Dark
        </label>
        <a
          className="text-blue-600 hover:underline text-sm"
          href={`${effectiveBase}/thoughtflow/${id}.d2`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open .d2
        </a>
        <a
          className="text-blue-600 hover:underline text-sm"
          href={`${effectiveBase}/thoughtflow/${id}.json`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open JSON
        </a>
      </div>
      <div className="flex-1 overflow-auto bg-gray-50">
        <div className="p-4">
          <div
            ref={svgRef}
            style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
          />
        </div>
        {loading && (
          <div className="p-4 text-gray-500">Rendering…</div>
        )}
        {error && (
          <div className="p-4 text-red-700">Error: {error}</div>
        )}
      </div>
    </div>
  );
}
