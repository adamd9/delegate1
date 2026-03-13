import { createOpenAIClient } from '../../../services/openaiClient';
import { generateEmbedding } from './embeddings';
import { findConsolidationCandidates, insertMemory, updateMemoryConsolidation, reinforceMemory } from './vectorStore';
import type { ConsolidationResult, ConflictNotice, DeltaEntry } from './types';
import { getMemoryConfig } from '../../memoryConfig';

const CONSOLIDATION_THRESHOLD = 0.85;
const STRENGTH_BOOST_ON_CONSOLIDATION = 0.2;

let _client: any = null;
function getClient() {
  if (!_client) _client = createOpenAIClient();
  return _client;
}

const DELTA_ANALYSIS_PROMPT = `You are analyzing two memory statements to determine their relationship.

Given an EXISTING memory and an INCOMING memory that are semantically similar:

1. Determine if they are CONSISTENT (same topic, compatible information) or CONFLICTING (same topic, contradictory information).
2. Extract the DELTA — what meaningful new information does the incoming memory add that the existing one doesn't already capture?

Respond in this exact JSON format:
{
  "relationship": "consistent" | "conflicting",
  "delta": "string describing what's new or different, or empty string if nothing new",
  "explanation": "brief explanation of your analysis"
}

If the incoming memory is essentially a duplicate with no new information, set delta to "".
If the memories conflict (e.g. different values for the same attribute), set relationship to "conflicting" and describe the conflict in delta.`;

/**
 * Attempt to store a new memory with consolidation.
 * - If no similar memory exists (below threshold), stores as new.
 * - If a similar memory exists and is consistent, consolidates (adds delta, boosts strength).
 * - If a similar memory exists but conflicts, returns a conflict notice.
 *
 * @param override - If true, force-store even on conflict (updates the canonical memory)
 */
export async function storeWithConsolidation(
  content: string,
  metadata: Record<string, any> = {},
  override: boolean = false
): Promise<ConsolidationResult> {
  const embedding = await generateEmbedding(content);
  const candidates = findConsolidationCandidates(embedding, CONSOLIDATION_THRESHOLD);

  // No strong match — store as new independent memory
  if (candidates.length === 0) {
    console.log('[adaptive] consolidation — no similar memories, storing as new');
    const id = insertMemory({ content, embedding, metadata });
    return { type: 'new', memoryId: id };
  }

  // Strong match found — analyze delta with LLM
  const best = candidates[0];
  const existing = best.record;

  console.log(`[adaptive] consolidation — found similar memory (sim=${best.cosineSimilarity.toFixed(3)}, strength=${existing.strength.toFixed(2)}): "${existing.content.slice(0, 80)}"`);

  const analysis = await analyzeDelta(existing.content, content);

  if (analysis.relationship === 'conflicting' && !override) {
    console.log(`[adaptive] consolidation — CONFLICT detected: "${analysis.delta}"`);
    const conflict: ConflictNotice = {
      existingMemory: existing.content,
      existingStrength: existing.strength,
      incomingContent: content,
      delta: analysis.delta,
    };
    return { type: 'conflict', memoryId: existing.id, conflict };
  }

  // Override conflict: replace canonical content and embedding
  if (analysis.relationship === 'conflicting' && override) {
    const { embeddingToBuffer } = await import('./embeddings');
    const db = (await import('../../../db/sqlite')).getDb();
    db.prepare('UPDATE adaptive_memories SET content = ?, embedding = ?, strength = strength + ?, last_consolidated_at = ? WHERE id = ?')
      .run(content, embeddingToBuffer(embedding), STRENGTH_BOOST_ON_CONSOLIDATION, Date.now(), existing.id);
    console.log(`[adaptive] consolidation — CONFLICT overridden, replaced canonical content for ${existing.id}`);
    return { type: 'consolidated', memoryId: existing.id };
  }

  // Consolidate: merge delta into existing memory
  if (analysis.delta) {
    const newDelta: DeltaEntry = {
      content: analysis.delta,
      sourceContent: content,
      consolidatedAt: Date.now(),
    };
    const updatedDeltas = [...existing.deltas, newDelta];
    updateMemoryConsolidation(existing.id, {
      strength: existing.strength + STRENGTH_BOOST_ON_CONSOLIDATION,
      deltas: updatedDeltas,
      lastConsolidatedAt: Date.now(),
    });
    console.log(`[adaptive] consolidation — merged delta into memory ${existing.id}: "${analysis.delta}"`);
  } else {
    // Pure duplicate — just boost strength
    reinforceMemory(existing.id, STRENGTH_BOOST_ON_CONSOLIDATION);
    console.log(`[adaptive] consolidation — duplicate, boosted strength for ${existing.id}`);
  }

  return { type: 'consolidated', memoryId: existing.id };
}

async function analyzeDelta(
  existingContent: string,
  incomingContent: string
): Promise<{ relationship: 'consistent' | 'conflicting'; delta: string; explanation: string }> {
  const client = getClient();
  const config = getMemoryConfig();

  try {
    const response = await client.chat.completions.create({
      model: config.extraction_model,
      messages: [
        { role: 'system', content: DELTA_ANALYSIS_PROMPT },
        {
          role: 'user',
          content: `EXISTING MEMORY: ${existingContent}\n\nINCOMING MEMORY: ${incomingContent}`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const text = response.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(text);
    return {
      relationship: parsed.relationship === 'conflicting' ? 'conflicting' : 'consistent',
      delta: parsed.delta || '',
      explanation: parsed.explanation || '',
    };
  } catch (e: any) {
    console.warn('[adaptive] delta analysis error:', e?.message || e);
    return { relationship: 'consistent', delta: incomingContent, explanation: 'Analysis failed, treating as new delta' };
  }
}
