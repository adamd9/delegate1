import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';
import { endSession } from '../../observability/thoughtflow';
import { getEventCountForSession } from '../../db/sqlite';

/**
 * Finalize any sessions that were left open (no session.ended) across restarts.
 * Safe to call at startup.
 */
export function finalizeOpenSessionsOnStartup() {
  try {
    const isDist = __dirname.includes(`${sep}dist${sep}`);
    const baseRoot = isDist ? join(__dirname, '..', '..', '..') : join(__dirname, '..', '..');
    const dir = join(baseRoot, 'runtime-data', 'thoughtflow');
    let files: string[] = [];
    try { files = readdirSync(dir); } catch { files = []; }
    const jsonl = files.filter(f => f.endsWith('.jsonl'));
    for (const f of jsonl) {
      const id = f.replace(/\.jsonl$/, '');
      try {
        const raw = readFileSync(join(dir, f), 'utf8');
        const lines = raw.split(/\n+/).filter(Boolean);
        const last = lines[lines.length - 1] || '';
        if (last.includes('session.ended')) continue;
        // Only finalize if there is evidence of a real conversation/run activity
        let hasActivity = false;
        for (const line of lines) {
          try {
            const evt = JSON.parse(line);
            const t = evt?.type as string | undefined;
            if (t === 'run.started' || t === 'step.started' || t === 'run.completed') {
              hasActivity = true;
              break;
            }
          } catch {}
        }
        if (!hasActivity) {
          // Skip auto-finalization for empty sessions (prevents phantom history rows after DB reset)
          continue;
        }
        // Only finalize if DB already has at least one real transcript message linked to this session's conversations
        try {
          const count = getEventCountForSession(id);
          if (!count || count <= 0) {
            // DB was likely wiped or there was no real conversation; do not finalize
            continue;
          }
        } catch {}
        console.log(`[startup] Finalizing partial session ${id}`);
        endSession({ sessionId: id, statusOverride: 'partial' });
      } catch (e) {
        console.warn(`[startup] Failed to inspect/finalize ${f}:`, (e as any)?.message || e);
      }
    }
  } catch (e) {
    console.warn('[startup] finalizeOpenSessionsOnStartup failed:', (e as any)?.message || e);
  }
}
