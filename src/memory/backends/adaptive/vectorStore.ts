import { getDb } from '../../../db/sqlite';
import { cosineSimilarity, embeddingToBuffer, bufferToEmbedding } from './embeddings';
import type { MemoryRecord, DeltaEntry, ScoredMemory, RerankWeights } from './types';
import { randomUUID } from 'crypto';

const DEFAULT_WEIGHTS: RerankWeights = { alpha: 0.7, beta: 0.3 };

let _initialized = false;

function ensureTable(): void {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS adaptive_memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      strength REAL NOT NULL DEFAULT 1.0,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      deltas_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      last_retrieved_at INTEGER,
      last_consolidated_at INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    )
  `);
  _initialized = true;
}

function rowToRecord(row: any): MemoryRecord {
  let deltas: DeltaEntry[] = [];
  let metadata: Record<string, any> = {};
  try { deltas = JSON.parse(row.deltas_json || '[]'); } catch { console.warn(`[adaptive] corrupt deltas_json for memory ${row.id}`); }
  try { metadata = JSON.parse(row.metadata_json || '{}'); } catch { console.warn(`[adaptive] corrupt metadata_json for memory ${row.id}`); }
  return {
    id: row.id,
    content: row.content,
    embedding: bufferToEmbedding(row.embedding),
    strength: row.strength,
    retrievalCount: row.retrieval_count,
    deltas,
    createdAt: row.created_at,
    lastRetrievedAt: row.last_retrieved_at,
    lastConsolidatedAt: row.last_consolidated_at,
    metadata,
  };
}

/** Insert a new memory record */
export function insertMemory(record: {
  content: string;
  embedding: Float32Array;
  strength?: number;
  metadata?: Record<string, any>;
}): string {
  ensureTable();
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO adaptive_memories (id, content, embedding, strength, retrieval_count, deltas_json, created_at, metadata_json)
    VALUES (?, ?, ?, ?, 0, '[]', ?, ?)
  `).run(id, record.content, embeddingToBuffer(record.embedding), record.strength ?? 1.0, now, JSON.stringify(record.metadata ?? {}));
  return id;
}

/** Get a memory by ID */
export function getMemory(id: string): MemoryRecord | null {
  ensureTable();
  const db = getDb();
  const row = db.prepare('SELECT * FROM adaptive_memories WHERE id = ?').get(id);
  return row ? rowToRecord(row) : null;
}

/** Get all memory records (for brute-force similarity search) */
export function getAllMemories(): MemoryRecord[] {
  ensureTable();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM adaptive_memories').all();
  return rows.map(rowToRecord);
}

/** Count of memories in the store */
export function countMemories(): number {
  ensureTable();
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM adaptive_memories').get() as any;
  return row?.cnt ?? 0;
}

/**
 * Search for similar memories using brute-force cosine similarity + strength reranking.
 * Returns top-K results sorted by final_score descending.
 */
export function searchSimilar(
  queryEmbedding: Float32Array,
  limit: number = 5,
  weights: RerankWeights = DEFAULT_WEIGHTS,
  minSimilarity: number = 0.3
): ScoredMemory[] {
  const allMemories = getAllMemories();
  if (allMemories.length === 0) return [];

  const maxStrength = Math.max(...allMemories.map(m => m.strength), 1.0);

  const scored: ScoredMemory[] = [];
  for (const record of allMemories) {
    const sim = cosineSimilarity(queryEmbedding, record.embedding);
    if (sim < minSimilarity) continue;
    const normStrength = record.strength / maxStrength;
    const finalScore = weights.alpha * sim + weights.beta * normStrength;
    scored.push({ record, cosineSimilarity: sim, finalScore });
  }

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored.slice(0, limit);
}

/**
 * Find memories above a consolidation threshold.
 * Used before storing to check for consolidation/conflict candidates.
 */
export function findConsolidationCandidates(
  embedding: Float32Array,
  threshold: number = 0.85
): ScoredMemory[] {
  const allMemories = getAllMemories();
  if (allMemories.length === 0) return [];

  const maxStrength = Math.max(...allMemories.map(m => m.strength), 1.0);

  const candidates: ScoredMemory[] = [];
  for (const record of allMemories) {
    const sim = cosineSimilarity(embedding, record.embedding);
    if (sim >= threshold) {
      const normStrength = record.strength / maxStrength;
      candidates.push({
        record,
        cosineSimilarity: sim,
        finalScore: 0.7 * sim + 0.3 * normStrength,
      });
    }
  }

  candidates.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);
  return candidates;
}

/** Increment retrieval count and strength for a memory, update last_retrieved_at */
export function reinforceMemory(id: string, strengthIncrement: number = 0.1): void {
  ensureTable();
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    UPDATE adaptive_memories
    SET strength = strength + ?,
        retrieval_count = retrieval_count + 1,
        last_retrieved_at = ?
    WHERE id = ?
  `).run(strengthIncrement, now, id);
}

/** Update a memory's content and/or deltas (after consolidation) */
export function updateMemoryConsolidation(id: string, updates: {
  strength?: number;
  deltas?: DeltaEntry[];
  lastConsolidatedAt?: number;
}): void {
  ensureTable();
  const db = getDb();
  const txn = db.transaction(() => {
    if (updates.strength !== undefined) {
      db.prepare('UPDATE adaptive_memories SET strength = ? WHERE id = ?').run(updates.strength, id);
    }
    if (updates.deltas !== undefined) {
      db.prepare('UPDATE adaptive_memories SET deltas_json = ? WHERE id = ?').run(JSON.stringify(updates.deltas), id);
    }
    if (updates.lastConsolidatedAt !== undefined) {
      db.prepare('UPDATE adaptive_memories SET last_consolidated_at = ? WHERE id = ?').run(updates.lastConsolidatedAt, id);
    }
  });
  txn();
}

/** Delete a memory by ID */
export function deleteMemory(id: string): void {
  ensureTable();
  const db = getDb();
  db.prepare('DELETE FROM adaptive_memories WHERE id = ?').run(id);
}

/** List all memories (for admin/debug), returns without embeddings for efficiency */
export function listMemoriesSummary(): Array<{ id: string; content: string; strength: number; retrievalCount: number; createdAt: number }> {
  ensureTable();
  const db = getDb();
  const rows = db.prepare('SELECT id, content, strength, retrieval_count, created_at FROM adaptive_memories ORDER BY strength DESC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    content: r.content,
    strength: r.strength,
    retrievalCount: r.retrieval_count,
    createdAt: r.created_at,
  }));
}
