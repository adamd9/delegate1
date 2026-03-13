/** A single memory record stored in the adaptive memory system */
export interface MemoryRecord {
  id: string;
  content: string;              // The canonical memory text
  embedding: Float32Array;      // 1536-dim embedding vector
  strength: number;             // Reinforcement score, starts at 1.0
  retrievalCount: number;       // How many times this memory was retrieved
  deltas: DeltaEntry[];         // Consolidated deltas from similar memories
  createdAt: number;            // epoch ms
  lastRetrievedAt: number | null;
  lastConsolidatedAt: number | null;
  metadata: Record<string, any>;
}

export interface DeltaEntry {
  content: string;              // LLM-analyzed semantic difference
  sourceContent: string;        // The incoming memory that was consolidated
  consolidatedAt: number;       // epoch ms
}

export interface ConsolidationResult {
  type: 'new' | 'consolidated' | 'conflict';
  memoryId: string;
  /** Only set when type === 'conflict' */
  conflict?: ConflictNotice;
}

export interface ConflictNotice {
  existingMemory: string;
  existingStrength: number;
  incomingContent: string;
  delta: string;
}

export interface ScoredMemory {
  record: MemoryRecord;
  cosineSimilarity: number;
  finalScore: number;           // α × cosine + β × normStrength
}

/** Tunable weights for the reranking formula */
export interface RerankWeights {
  alpha: number;  // cosine similarity weight (default 0.7)
  beta: number;   // normalized strength weight (default 0.3)
}
