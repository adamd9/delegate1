import { createOpenAIClient } from '../../../services/openaiClient';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

let _client: any = null;
function getClient() {
  if (!_client) _client = createOpenAIClient();
  return _client;
}

/** Generate embedding for a text string. Returns Float32Array of 1536 dimensions. */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.trim(),
    dimensions: EMBEDDING_DIMS,
  });
  const vec = response.data[0].embedding;
  return new Float32Array(vec);
}

/** Cosine similarity between two Float32Array vectors. Returns value in [-1, 1]. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Serialize Float32Array to Buffer for SQLite BLOB storage */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/** Deserialize Buffer from SQLite BLOB to Float32Array */
export function bufferToEmbedding(buf: Buffer): Float32Array {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) view[i] = buf[i];
  return new Float32Array(ab);
}

export { EMBEDDING_DIMS };
