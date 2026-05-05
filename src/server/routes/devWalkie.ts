/**
 * TEMPORARY: Debug log receiver for ZeppOS walkie-talkie development.
 * 
 * Routes under /_dev/walkie/ — to be removed once walkie-talkie is stable.
 * 
 * Endpoints:
 *   POST /_dev/walkie/logs        — receive log batches from watch
 *   GET  /_dev/walkie/logs        — retrieve recent logs (polling)
 *   GET  /_dev/walkie/logs/stream — SSE stream of logs (real-time tail)
 *   DELETE /_dev/walkie/logs      — clear stored logs
 */
import type { Application, Request, Response } from "express";

interface LogEntry {
  ts: number;
  level: string;
  tag: string;
  msg: string;
  data?: any;
}

interface LogBatch {
  device_id: string;
  session_id: string;
  entries: LogEntry[];
}

// In-memory ring buffer for logs (survives requests, not restarts — fine for dev)
const MAX_LOG_ENTRIES = 2000;
const logStore: LogEntry[] = [];
const sseClients: Set<Response> = new Set();

function addEntries(entries: LogEntry[]) {
  for (const entry of entries) {
    logStore.push(entry);
    if (logStore.length > MAX_LOG_ENTRIES) {
      logStore.shift();
    }
    // Push to SSE clients
    const data = JSON.stringify(entry);
    for (const client of sseClients) {
      client.write(`data: ${data}\n\n`);
    }
  }
}

export function registerDevWalkieRoutes(app: Application) {
  // Receive log batch from watch/side-service
  app.post("/_dev/walkie/logs", (req: Request, res: Response) => {
    const batch = req.body as LogBatch;
    if (!batch || !Array.isArray(batch.entries)) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    // Tag entries with device/session for filtering
    const enriched = batch.entries.map(e => ({
      ...e,
      device_id: batch.device_id || "unknown",
      session_id: batch.session_id || "unknown",
    }));

    addEntries(enriched);

    console.log(
      `[_dev/walkie] Received ${enriched.length} log entries from ${batch.device_id}/${batch.session_id}`
    );

    res.json({ ok: true, stored: enriched.length, total: logStore.length });
  });

  // Retrieve recent logs (polling)
  app.get("/_dev/walkie/logs", (req: Request, res: Response) => {
    const since = req.query.since ? Number(req.query.since) : 0;
    const level = req.query.level as string | undefined;
    const tag = req.query.tag as string | undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : 100;
    const device_id = req.query.device_id as string | undefined;

    let filtered = logStore;

    if (since > 0) {
      filtered = filtered.filter(e => e.ts > since);
    }
    if (level) {
      filtered = filtered.filter(e => e.level === level);
    }
    if (tag) {
      filtered = filtered.filter(e => e.tag === tag);
    }
    if (device_id) {
      filtered = filtered.filter(e => (e as any).device_id === device_id);
    }

    // Return newest last, limited
    const result = filtered.slice(-limit);
    res.json({ entries: result, total: logStore.length });
  });

  // SSE stream for real-time log tailing
  app.get("/_dev/walkie/logs/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Send recent history first
    const last20 = logStore.slice(-20);
    for (const entry of last20) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    sseClients.add(res);

    req.on("close", () => {
      sseClients.delete(res);
    });
  });

  // Clear logs
  app.delete("/_dev/walkie/logs", (_req: Request, res: Response) => {
    logStore.length = 0;
    res.json({ ok: true, message: "Logs cleared" });
  });

  console.log("[_dev/walkie] Debug log routes registered at /_dev/walkie/logs");
}
