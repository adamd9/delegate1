/**
 * REST + SSE endpoints for the Copilot Tasks system.
 *
 *   GET    /api/copilot/tasks?status=&include_archived=
 *   POST   /api/copilot/tasks                       { title?, prompt }
 *   GET    /api/copilot/tasks/:id
 *   POST   /api/copilot/tasks/:id/continue          { prompt }
 *   POST   /api/copilot/tasks/:id/cancel
 *   POST   /api/copilot/tasks/:id/archive           { archived?: boolean }
 *   GET    /api/copilot/tasks/:id/events?after_id=  (one-shot)
 *   GET    /api/copilot/tasks/:id/events/stream     (SSE)
 *   GET    /api/copilot/tasks/:id/files?path=
 *   GET    /api/copilot/tasks/:id/file?path=
 *   POST   /api/copilot/tasks/:id/ask               { prompt }   — uses chat agent, no new Copilot turn
 */

import type { Application, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { applySafeHtmlHeaders, renderMarkdownHtmlPage } from '../markdown';
import {
  getTask,
  listTasks,
  listEvents,
  updateTask,
  CopilotTaskRow,
  summarizeTask,
  TaskStatus,
} from '../../copilot/tasks';
import {
  createTaskWithFirstTurn,
  enqueueInput,
  cancelActiveTurn,
  getActiveTurn,
  taskWorkdir,
} from '../../copilot/taskRunner';

const VALID_STATUSES: TaskStatus[] = ['running', 'awaiting_user', 'completed', 'failed', 'idle', 'archived'];

function serializeTask(t: CopilotTaskRow) {
  return {
    id: t.id,
    copilot_session_id: t.copilot_session_id,
    title: t.title,
    status: t.status,
    workdir: t.workdir,
    originating_conversation_id: t.originating_conversation_id,
    created_at: new Date(t.created_at_ms).toISOString(),
    last_active_at: new Date(t.last_active_at_ms).toISOString(),
    ended_at: t.ended_at_ms ? new Date(t.ended_at_ms).toISOString() : null,
    last_prompt: t.last_prompt,
    last_summary: t.last_summary,
    needs_user_reason: t.needs_user_reason,
    turn_count: t.turn_count,
    archived: !!t.archived,
    meta: (() => { try { return t.meta_json ? JSON.parse(t.meta_json) : null; } catch { return null; } })(),
  };
}

function safeJoinWithinWorkdir(workdir: string, rel: string): string | null {
  const normalisedRel = path.posix.normalize('/' + (rel || '').replace(/\\/g, '/')).replace(/^\/+/, '');
  if (normalisedRel.startsWith('..') || normalisedRel.includes('..\\') || normalisedRel.includes('../')) return null;
  const abs = path.resolve(workdir, normalisedRel);
  const root = path.resolve(workdir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

export function registerCopilotTasksRoutes(app: Application) {
  // GET /api/copilot/tasks
  app.get('/api/copilot/tasks', (req: Request, res: Response) => {
    try {
      const statusParam = String(req.query.status || '').trim();
      const statuses = statusParam
        ? statusParam.split(',').map(s => s.trim()).filter(s => (VALID_STATUSES as string[]).includes(s)) as TaskStatus[]
        : undefined;
      const includeArchived = String(req.query.include_archived || '') === 'true';
      const limit = req.query.limit ? Math.min(500, Math.max(1, parseInt(String(req.query.limit), 10) || 100)) : 100;
      const rows = listTasks({ statuses, includeArchived, limit });
      const active = getActiveTurn();
      res.json({
        tasks: rows.map(serializeTask),
        active_turn: active ? { task_id: active.taskId, started_at: new Date(active.startedAt).toISOString(), pid: active.pid } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'internal' });
    }
  });

  // POST /api/copilot/tasks
  app.post('/api/copilot/tasks', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return res.status(400).json({ error: 'prompt is required' });
      const title = body.title ? String(body.title).trim() : undefined;
      const result = await createTaskWithFirstTurn({
        prompt,
        title,
        source: 'user-direct',
        via: 'tasks-ui',
      });
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ task: serializeTask(result.task) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'internal' });
    }
  });

  // GET /api/copilot/tasks/:id
  app.get('/api/copilot/tasks/:id', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({ task: serializeTask(t) });
  });

  // POST /api/copilot/tasks/:id/continue
  app.post('/api/copilot/tasks/:id/continue', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    if (t.archived) return res.status(400).json({ error: 'task is archived' });
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const source = String(req.body?.source || 'user-direct');
    const via = String(req.body?.via || 'tasks-ui');
    try {
      const active = getActiveTurn();
      if (active && active.taskId !== t.id) {
        return res.status(409).json({
          error: 'another task is currently running',
          busy_task_id: active.taskId,
        });
      }
      const result = enqueueInput({ taskId: t.id, prompt, source, via });
      res.json({
        accepted: true,
        queued: result.queued,
        will_start_immediately: result.willStartImmediately,
        event_id: result.event.id,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'internal' });
    }
  });

  // POST /api/copilot/tasks/:id/cancel
  app.post('/api/copilot/tasks/:id/cancel', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    const result = cancelActiveTurn(t.id);
    res.json(result);
  });

  // POST /api/copilot/tasks/:id/archive
  app.post('/api/copilot/tasks/:id/archive', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    const archived = req.body?.archived === false ? 0 : 1;
    const updated = updateTask(t.id, { archived: archived as 0 | 1, status: archived ? 'archived' : (t.status === 'archived' ? 'idle' : t.status) });
    res.json({ task: updated ? serializeTask(updated) : null });
  });

  // GET /api/copilot/tasks/:id/events
  app.get('/api/copilot/tasks/:id/events', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    const afterId = req.query.after_id ? parseInt(String(req.query.after_id), 10) : undefined;
    const limit = req.query.limit ? Math.min(5000, Math.max(1, parseInt(String(req.query.limit), 10) || 1000)) : 1000;
    const events = listEvents(t.id, { afterId, limit });
    res.json({ events });
  });

  // GET /api/copilot/tasks/:id/events/stream  — Server-Sent Events
  app.get('/api/copilot/tasks/:id/events/stream', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    let lastId = req.query.after_id ? parseInt(String(req.query.after_id), 10) : 0;

    // Replay backlog
    const backlog = listEvents(t.id, { afterId: lastId });
    for (const ev of backlog) {
      res.write(`event: task_event\nid: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
      lastId = ev.id;
    }
    // Also send a snapshot of the task row so the client can render header on connect
    const fresh = getTask(t.id);
    if (fresh) res.write(`event: task_snapshot\ndata: ${JSON.stringify(serializeTask(fresh))}\n\n`);

    // Poll for new events at 750ms intervals (cheap; events table is small per task)
    const poll = setInterval(() => {
      try {
        const fresh = listEvents(t.id, { afterId: lastId });
        for (const ev of fresh) {
          res.write(`event: task_event\nid: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
          lastId = ev.id;
        }
        // Heartbeat every poll to keep proxies happy
        res.write(': hb\n\n');
      } catch (err) {
        clearInterval(poll);
        try { res.end(); } catch { /* */ }
      }
    }, 750);

    // Push task-row snapshots every 2s so header status stays fresh
    const snapPoll = setInterval(() => {
      try {
        const row = getTask(t.id);
        if (row) res.write(`event: task_snapshot\ndata: ${JSON.stringify(serializeTask(row))}\n\n`);
      } catch { /* */ }
    }, 2000);

    req.on('close', () => {
      clearInterval(poll);
      clearInterval(snapPoll);
    });
  });

  // GET /api/copilot/tasks/:id/files?path=
  app.get('/api/copilot/tasks/:id/files', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    const wd = taskWorkdir(t.id);
    const rel = String(req.query.path || '').trim();
    const abs = safeJoinWithinWorkdir(wd, rel);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'not found on disk' });
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      return res.json({
        kind: 'file',
        path: rel,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
    if (!stat.isDirectory()) return res.status(400).json({ error: 'unsupported entry' });
    const entries = fs.readdirSync(abs).map(name => {
      try {
        const s = fs.statSync(path.join(abs, name));
        return {
          name,
          path: rel ? path.posix.join(rel, name) : name,
          kind: s.isDirectory() ? 'dir' : 'file',
          size: s.isFile() ? s.size : null,
          modified: s.mtime.toISOString(),
        };
      } catch { return null; }
    }).filter(Boolean);
    entries.sort((a: any, b: any) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ kind: 'dir', path: rel, entries });
  });

  // GET /api/copilot/tasks/:id/file?path=  — fetch single file (text or binary)
  app.get('/api/copilot/tasks/:id/file', (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    const wd = taskWorkdir(t.id);
    const rel = String(req.query.path || '').trim();
    if (!rel) return res.status(400).json({ error: 'path is required' });
    const abs = safeJoinWithinWorkdir(wd, rel);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).json({ error: 'file not found' });
    const stat = fs.statSync(abs);
    const MAX = 5 * 1024 * 1024;
    if (stat.size > MAX && !req.query.download) {
      return res.status(413).json({ error: `file too large (${stat.size} bytes); use ?download=1` });
    }
    const ext = path.extname(abs).toLowerCase();
    const renderMarkdown = String(req.query.render || '') === '1';
    if (renderMarkdown && ext === '.md' && !req.query.download) {
      try {
        const content = fs.readFileSync(abs, 'utf8');
        applySafeHtmlHeaders(res);
        res.send(renderMarkdownHtmlPage({
          title: path.basename(rel),
          content,
          timestamp: stat.mtimeMs || Date.now(),
        }));
        return;
      } catch (err: any) {
        return res.status(500).json({ error: err?.message || 'failed to render markdown' });
      }
    }
    const typeMap: Record<string, string> = {
      '.txt': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.htm': 'text/html; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
      '.log': 'text/plain; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
    };
    const ct = typeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
    }
    fs.createReadStream(abs).pipe(res);
  });

  // POST /api/copilot/tasks/:id/ask  — cheap query against the chat agent with task context
  app.post('/api/copilot/tasks/:id/ask', async (req: Request, res: Response) => {
    const t = getTask(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'not found' });
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    try {
      const summary = summarizeTask(t.id, { tailChars: 6000 });
      const fileList = (() => {
        try {
          const wd = taskWorkdir(t.id);
          if (!fs.existsSync(wd)) return [];
          const out: string[] = [];
          const walk = (dir: string, prefix: string) => {
            for (const name of fs.readdirSync(dir).slice(0, 200)) {
              if (name === '.git' || name === 'node_modules') continue;
              try {
                const p = path.join(dir, name);
                const s = fs.statSync(p);
                if (s.isDirectory()) walk(p, path.posix.join(prefix, name));
                else out.push(path.posix.join(prefix, name) + ` (${s.size}b)`);
                if (out.length > 200) break;
              } catch { /* */ }
            }
          };
          walk(wd, '');
          return out;
        } catch { return []; }
      })();

      const contextBlock =
        `You are answering a question about an existing Copilot task. ` +
        `Do NOT send new instructions to the task. Use only the context below to answer concisely.\n\n` +
        `Task id: ${t.id}\nTitle: ${t.title}\nStatus: ${t.status}\n` +
        (t.needs_user_reason ? `Needs user: ${t.needs_user_reason}\n` : '') +
        `Last prompt: ${t.last_prompt || '(none)'}\n` +
        `Last summary: ${t.last_summary || '(none)'}\n` +
        `\nRecent output (tail):\n${summary?.recentOutput || '(none)'}\n` +
        `\nFiles in working directory (${fileList.length}):\n${fileList.slice(0, 80).join('\n') || '(none)'}\n` +
        `\nUser question: ${prompt}`;

      // Use the Responses API directly with the existing OpenAI key.
      const apiKey = process.env.OPENAI_API_KEY || '';
      if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          input: contextBlock,
          max_output_tokens: 600,
        }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(502).json({ error: `OpenAI error: ${errText.slice(0, 400)}` });
      }
      const data: any = await r.json();
      // Normalise output_text
      let answer = '';
      if (typeof data.output_text === 'string' && data.output_text.length) {
        answer = data.output_text;
      } else if (Array.isArray(data.output)) {
        for (const block of data.output) {
          if (Array.isArray(block?.content)) {
            for (const c of block.content) {
              if (typeof c?.text === 'string') answer += c.text;
            }
          }
        }
      }
      res.json({ answer: answer.trim() || '(no answer)' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'internal' });
    }
  });
}
