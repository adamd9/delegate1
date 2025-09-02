import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { session } from '../session/state';

// Store artifacts under a runtime data folder that is gitignored
const BASE_DIR = join(__dirname, '..', 'runtime-data', 'thoughtflow');

function ensureDir() {
  if (!existsSync(BASE_DIR)) {
    mkdirSync(BASE_DIR, { recursive: true });
  }
}

export function ensureSession(): { id: string; jsonlPath: string } {
  ensureDir();
  const tf = (session.thoughtflow ||= {} as any);
  if (!tf.sessionId) {
    tf.sessionId = `sess_${Date.now()}`;
    tf.startedAt = Date.now();
  }
  const jsonlPath = join(BASE_DIR, `${tf.sessionId}.jsonl`);
  tf.jsonlPath = jsonlPath;
  // Touch file with a header line only once
  if (!existsSync(jsonlPath)) {
    const header = JSON.stringify({ type: 'session.created', session_id: tf.sessionId, started_at: new Date(tf.startedAt!).toISOString() });
    appendFileSync(jsonlPath, header + '\n');
  }
  return { id: tf.sessionId, jsonlPath };
}

export function appendEvent(event: any) {
  try {
    const { jsonlPath } = ensureSession();
    appendFileSync(jsonlPath, JSON.stringify(event) + '\n');
  } catch (e) {
    console.warn('[thoughtflow] appendEvent failed:', (e as any)?.message || e);
  }
}

export function endSession(): { id: string; jsonPath: string } | null {
  try {
    const { id, jsonlPath } = ensureSession();
    const jsonPath = join(BASE_DIR, `${id}.json`);
    // Minimal consolidated JSON (no runs yet). Future phases will aggregate.
    const consolidated = {
      session_id: id,
      started_at: new Date((session.thoughtflow as any).startedAt!).toISOString(),
      ended_at: new Date().toISOString(),
      runs: [],
    };
    writeFileSync(jsonPath, JSON.stringify(consolidated, null, 2));
    appendFileSync(jsonlPath, JSON.stringify({ type: 'session.ended', session_id: id, ended_at: consolidated.ended_at }) + '\n');
    return { id, jsonPath };
  } catch (e) {
    console.warn('[thoughtflow] endSession failed:', (e as any)?.message || e);
    return null;
  }
}
