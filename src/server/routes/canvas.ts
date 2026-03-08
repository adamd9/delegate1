import type { Application, Request, Response } from 'express';
import { marked } from 'marked';
import { getCanvas } from '../../canvasStore';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  if (!v) return '';
  if (v.startsWith('#')) return v;
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' || u.protocol === 'tel:') return u.toString();
    return '';
  } catch {
    return '';
  }
}

const renderer = new marked.Renderer();

// marked supports both legacy (string args) and token-object signatures across versions.
renderer.html = (arg1: any) => {
  const raw = typeof arg1 === 'string' ? arg1 : (arg1 && typeof arg1.text === 'string' ? arg1.text : '');
  return escapeHtml(raw);
};

renderer.link = (...args: any[]) => {
  const a0 = args[0];
  const hrefRaw = typeof a0 === 'object' && a0 ? a0.href : args[0];
  const titleRaw = typeof a0 === 'object' && a0 ? a0.title : args[1];
  const text = typeof a0 === 'object' && a0 ? a0.text : args[2];

  const href = safeUrl(hrefRaw);
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : '';
  const label = typeof text === 'string' && text.length ? text : (href || '');
  if (!href) return `<span>${label}</span>`;

  const titleAttr = title ? ` title=\"${escapeHtml(title)}\"` : '';
  return `<a href=\"${escapeHtml(href)}\"${titleAttr} target=\"_blank\" rel=\"noopener noreferrer\">${label}</a>`;
};

renderer.image = (...args: any[]) => {
  const a0 = args[0];
  const hrefRaw = typeof a0 === 'object' && a0 ? a0.href : args[0];
  const titleRaw = typeof a0 === 'object' && a0 ? a0.title : args[1];
  const textRaw = typeof a0 === 'object' && a0 ? a0.text : args[2];

  const src = safeUrl(hrefRaw);
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : '';
  const alt = typeof textRaw === 'string' ? textRaw : '';
  if (!src) return '';

  const titleAttr = title ? ` title=\"${escapeHtml(title)}\"` : '';
  return `<img src=\"${escapeHtml(src)}\" alt=\"${escapeHtml(alt)}\"${titleAttr} loading=\"lazy\" />`;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer,
});

function renderCanvasHtmlPage({ title, content, timestamp }: { title: string; content: string; timestamp: number }) {
  const rendered = marked.parse(content ?? '');
  const safeTitle = escapeHtml(title || 'Canvas');
  const iso = new Date(timestamp || Date.now()).toISOString();
  const safeIso = escapeHtml(iso);

  // Minimal, GitHub-esque markdown typography without external assets.
  const styles = `
    :root {
      --bg: #f6f8fa;
      --panel: #ffffff;
      --fg: #1f2328;
      --muted: #57606a;
      --border: #d0d7de;
      --link: #0969da;
      --code-bg: #f6f8fa;
    }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      line-height: 1.5;
    }
    .container { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
    .header {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 12px 0 16px;
    }
    .header-title {
      font-size: 20px;
      font-weight: 650;
      margin: 0;
      line-height: 1.25;
      word-break: break-word;
    }
    .header-meta { color: var(--muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .markdown-body {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      box-shadow: 0 1px 0 rgba(31, 35, 40, 0.04);
    }
    .markdown-body > :first-child { margin-top: 0; }
    .markdown-body > :last-child { margin-bottom: 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 {
      margin-top: 24px;
      margin-bottom: 12px;
      line-height: 1.25;
      font-weight: 650;
    }
    .markdown-body h1 { font-size: 1.6em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
    .markdown-body h2 { font-size: 1.35em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
    .markdown-body h3 { font-size: 1.15em; }
    .markdown-body p { margin: 0 0 16px; }
    .markdown-body a { color: var(--link); text-decoration: none; }
    .markdown-body a:hover { text-decoration: underline; }
    .markdown-body hr { border: 0; border-top: 1px solid var(--border); margin: 24px 0; }
    .markdown-body blockquote {
      margin: 0 0 16px;
      padding: 0 1em;
      color: var(--muted);
      border-left: .25em solid var(--border);
    }
    .markdown-body ul, .markdown-body ol { margin: 0 0 16px; padding-left: 2em; }
    .markdown-body li { margin: 0.25em 0; }
    .markdown-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.95em;
      background: var(--code-bg);
      border: 1px solid rgba(208, 215, 222, 0.7);
      border-radius: 6px;
      padding: 0.15em 0.35em;
    }
    .markdown-body pre {
      margin: 0 0 16px;
      padding: 14px;
      overflow: auto;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .markdown-body pre code {
      background: transparent;
      border: 0;
      padding: 0;
      font-size: 0.9em;
      white-space: pre;
    }
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 16px;
      display: block;
      overflow: auto;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
    }
    .markdown-body th { background: var(--code-bg); font-weight: 650; }
    .markdown-body img { max-width: 100%; height: auto; }
    @media (max-width: 640px) {
      .container { padding: 16px 12px 40px; }
      .markdown-body { padding: 18px; border-radius: 10px; }
    }
  `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>${styles}</style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1 class="header-title">${safeTitle}</h1>
        <div class="header-meta">${safeIso}</div>
      </div>
      <article class="markdown-body">${rendered}</article>
    </div>
  </body>
</html>`;
}

export function registerCanvasRoutes(app: Application) {
  // Endpoint to serve stored canvas content as HTML
  app.get('/canvas/:id', async (req: Request, res: Response) => {
    const data = await getCanvas((req.params as any).id);
    if (!data) {
      res.status(404).send('Not found');
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "img-src https: http: data:",
        "style-src 'unsafe-inline'",
        "font-src https: http: data:",
        "script-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ')
    );

    const title = typeof (data as any).title === 'string' && (data as any).title.trim() ? (data as any).title.trim() : 'Canvas';
    const content = typeof (data as any).content === 'string' ? (data as any).content : '';
    const timestamp = typeof (data as any).timestamp === 'number' ? (data as any).timestamp : Date.now();
    res.send(renderCanvasHtmlPage({ title, content, timestamp }));
  });
}
