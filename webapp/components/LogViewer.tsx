"use client";

import React from "react";

// Minimal ANSI -> HTML converter supporting common styles/colors.
// We avoid extra deps to keep the UI lightweight.
const ansiPattern = /\u001b\[(\d+(?:;\d+)*)m/g; // ESC[...m

const ansiStyles: Record<string, React.CSSProperties> = {
  // text styles
  "1": { fontWeight: 700 }, // bold
  "2": { opacity: 0.75 }, // dim
  "3": { fontStyle: "italic" }, // italic
  "4": { textDecoration: "underline" }, // underline

  // foreground colors
  "30": { color: "#000000" },
  "31": { color: "#dc2626" }, // red-600
  "32": { color: "#16a34a" }, // green-600
  "33": { color: "#ca8a04" }, // yellow-600
  "34": { color: "#2563eb" }, // blue-600
  "35": { color: "#9333ea" }, // magenta-600
  "36": { color: "#0891b2" }, // cyan-600
  "37": { color: "#e5e7eb" }, // white-ish

  // bright foreground
  "90": { color: "#737373" }, // gray-500
  "91": { color: "#ef4444" },
  "92": { color: "#22c55e" },
  "93": { color: "#eab308" },
  "94": { color: "#3b82f6" },
  "95": { color: "#a855f7" },
  "96": { color: "#06b6d4" },
  "97": { color: "#f3f4f6" },

  // background colors (basic)
  "40": { backgroundColor: "#000000" },
  "41": { backgroundColor: "#7f1d1d", color: "#fff" },
  "42": { backgroundColor: "#064e3b", color: "#d1fae5" },
  "43": { backgroundColor: "#78350f", color: "#fffbeb" },
  "44": { backgroundColor: "#1e3a8a", color: "#dbeafe" },
  "45": { backgroundColor: "#581c87", color: "#f5f3ff" },
  "46": { backgroundColor: "#164e63", color: "#cffafe" },
  "47": { backgroundColor: "#e5e7eb", color: "#111827" },
};

function mergeStyles(keys: string[]): React.CSSProperties | undefined {
  const style: React.CSSProperties = {};
  for (const k of keys) Object.assign(style, ansiStyles[k]);
  return Object.keys(style).length ? style : undefined;
}

function spanifyAnsi(input: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentCodes: string[] = [];

  input.replace(ansiPattern, (match, codes, offset) => {
    // push preceding text with current style
    if (offset > lastIndex) {
      const text = input.slice(lastIndex, offset);
      nodes.push(
        <span key={`${offset}-txt`} style={mergeStyles(currentCodes)}>
          {text}
        </span>
      );
    }

    const parts = String(codes).split(";");
    // Handle reset (0)
    if (parts.includes("0")) {
      currentCodes = [];
    }
    // Merge other codes
    currentCodes = [...currentCodes.filter((c) => c !== "0"), ...parts.filter((p) => p !== "0")];

    lastIndex = offset + match.length;
    return "";
  });

  // trailing text
  if (lastIndex < input.length) {
    nodes.push(
      <span key={`${lastIndex}-trail`} style={mergeStyles(currentCodes)}>
        {input.slice(lastIndex)}
      </span>
    );
  }

  return nodes;
}

// Extract a balanced JSON block from text starting at the first '{' or '['.
function extractJsonBlock(text: string): { json: string; start: number; end: number } | null {
  const clean = text.replace(ansiPattern, "");
  const firstCurly = clean.indexOf("{");
  const firstBracket = clean.indexOf("[");
  const starts = [firstCurly, firstBracket].filter((i) => i >= 0).sort((a, b) => a - b);
  if (starts.length === 0) return null;
  const start = starts[0];
  const open = clean[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return { json: clean.slice(start, i + 1), start, end: i + 1 };
      }
    }
  }
  return null;
}

type LogItem =
  | { kind: "line"; line: string }
  | { kind: "json"; prefix: string; pretty: string }
  | { kind: "long"; prefix: string; remainder: string; length: number };

function buildLogItems(lines: string[]): LogItem[] {
  const items: LogItem[] = [];
  const LONG_LINE_THRESHOLD = 300; // chars
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      items.push({ kind: "line", line });
      continue;
    }
    // Look for a JSON start on this line
    const firstCurly = line.indexOf("{");
    const firstBracket = line.indexOf("[");
    const startIdx = [firstCurly, firstBracket].filter((x) => x >= 0).sort((a, b) => a - b)[0];
    if (startIdx === undefined) {
      // Not JSON: if line is very long, split into a collapsible chunk
      if (line.length > LONG_LINE_THRESHOLD) {
        const prefix = line.slice(0, LONG_LINE_THRESHOLD);
        const remainder = line.slice(LONG_LINE_THRESHOLD);
        items.push({ kind: "long", prefix, remainder, length: line.length });
      } else {
        items.push({ kind: "line", line });
      }
      continue;
    }

    const prefix = line.slice(0, startIdx);
    let combined = line.slice(startIdx) + "\n";
    let endIndex = i;

    // Try to accumulate following lines until we can extract a balanced JSON block
    for (let j = i + 1; j < Math.min(lines.length, i + 500); j++) {
      const candidate = extractJsonBlock(combined);
      if (candidate) {
        try {
          const parsed = JSON.parse(candidate.json);
          const pretty = JSON.stringify(parsed, null, 2);
          items.push({ kind: "json", prefix, pretty });
          i = endIndex; // will be advanced at loop increment
          break;
        } catch {
          // keep accumulating if parse fails
        }
      }
      combined += lines[j] + "\n";
      endIndex = j;
      // last iteration check
      if (j === Math.min(lines.length, i + 500) - 1) {
        const lastTry = extractJsonBlock(combined);
        if (lastTry) {
          try {
            const parsed2 = JSON.parse(lastTry.json);
            const pretty2 = JSON.stringify(parsed2, null, 2);
            items.push({ kind: "json", prefix, pretty: pretty2 });
            i = endIndex;
            break;
          } catch {
            // fallthrough
          }
        }
      }
    }

    // If we didn't push a json item (no balanced block), push the original line
    if (items.length === 0 || items[items.length - 1].kind !== "json") {
      // If the original line is very long (e.g., large field values like instructions), collapse it
      if (line.length > LONG_LINE_THRESHOLD) {
        const head = line.slice(0, Math.min(LONG_LINE_THRESHOLD, startIdx + LONG_LINE_THRESHOLD));
        const tail = line.slice(head.length);
        items.push({ kind: "long", prefix: head, remainder: tail, length: line.length });
      } else {
        items.push({ kind: "line", line });
      }
    }
  }
  return items;
}

function useAutoRefresh(intervalMs: number, fetcher: () => Promise<void>) {
  React.useEffect(() => {
    const id = setInterval(() => {
      fetcher().catch(() => {});
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, fetcher]);
}

export default function LogViewer() {
  const [raw, setRaw] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  const fetchLogs = React.useCallback(async () => {
    if (paused) return;
    const res = await fetch("/api/backend-logs", { cache: "no-store" });
    if (!res.ok) {
      const txt = await res.text();
      setError(`Failed to load logs: ${res.status} ${txt}`);
      return;
    }
    const txt = await res.text();
    setRaw(txt);
    setError(null);
  }, [paused]);

  // Initial + polling
  React.useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useAutoRefresh(1500, fetchLogs);

  // Auto-scroll handling
  React.useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [raw, autoScroll]);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 24; // px
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setAutoScroll(atBottom);
  }, []);

  const lines = React.useMemo(() => (raw ? raw.split("\n") : []), [raw]);
  const items = React.useMemo(() => buildLogItems(lines), [lines]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 p-2 text-sm dark:border-gray-800">
        <button
          className="rounded border px-2 py-1 hover:bg-gray-50 dark:hover:bg-neutral-800"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          className="rounded border px-2 py-1 hover:bg-gray-50 dark:hover:bg-neutral-800"
          onClick={() => fetchLogs()}
        >
          Refresh
        </button>
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          <span>{lines.length} lines</span>
          {!autoScroll && <span>Auto-scroll off</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="log-scroll flex-1 overflow-auto bg-neutral-950 p-3 font-mono text-[12px] leading-5 text-neutral-200"
      >
        {items.map((it, idx) => {
          if (it.kind === "line") {
            if (!it.line) return <div key={idx}>&nbsp;</div>;
            return (
              <div key={idx} className="whitespace-pre-wrap break-words">
                {spanifyAnsi(it.line)}
              </div>
            );
          }
          if (it.kind === "long") {
            return (
              <div key={idx} className="whitespace-pre-wrap break-words">
                <span>{spanifyAnsi(it.prefix)}</span>
                <details className="ml-2 inline-block align-top">
                  <summary className="cursor-pointer select-none text-blue-600 hover:underline">
                    … ({it.length} chars)
                  </summary>
                  <pre className="mt-1 max-h-80 overflow-auto rounded bg-neutral-900 p-3 text-xs text-neutral-100 whitespace-pre-wrap break-words">
{it.remainder}
                  </pre>
                </details>
              </div>
            );
          }
          return (
            <div key={idx} className="whitespace-pre-wrap break-words">
              <span>{spanifyAnsi(it.prefix)}</span>
              <details className="ml-2 inline-block align-top">
                <summary className="cursor-pointer select-none text-blue-600 hover:underline">
                  JSON ({it.pretty.length} chars)
                </summary>
                <pre className="mt-1 max-h-80 overflow-auto rounded bg-neutral-900 p-3 text-xs text-neutral-100 whitespace-pre-wrap break-words">
{it.pretty}
                </pre>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
