import type { MemoryBackend } from '../../types';
import { generateEmbedding } from './embeddings';
import { searchSimilar, reinforceMemory, countMemories } from './vectorStore';
import { storeWithConsolidation } from './consolidation';

export class AdaptiveMemoryBackend implements MemoryBackend {
  readonly available: boolean = true;

  async retrieve(query: string, limit: number = 5): Promise<string | null> {
    if (!query.trim()) return null;

    try {
      const count = countMemories();
      if (count === 0) return null;

      console.log(`[adaptive] retrieve — query: "${query.slice(0, 80)}" limit: ${limit}, store size: ${count}`);
      const t = Date.now();
      const queryEmbedding = await generateEmbedding(query);
      const results = searchSimilar(queryEmbedding, limit);
      const elapsed = Date.now() - t;

      if (results.length === 0) {
        console.log(`[adaptive] retrieve — no results above threshold (${elapsed}ms)`);
        return null;
      }

      // Reinforce retrieved memories (strength through use)
      for (const result of results) {
        reinforceMemory(result.record.id);
      }

      const lines = results.map(r => {
        const deltaSuffix = r.record.deltas.length > 0
          ? ` [+${r.record.deltas.length} update(s)]`
          : '';
        return `- ${r.record.content}${deltaSuffix}`;
      });

      console.log(`[adaptive] retrieve — ${results.length} result(s) in ${elapsed}ms (top score: ${results[0].finalScore.toFixed(3)})`);
      return lines.join('\n');
    } catch (e: any) {
      console.warn('[adaptive] retrieve error:', e?.message || e);
      return null;
    }
  }

  async add(content: string, metadata?: Record<string, any>): Promise<void> {
    if (!content.trim()) return;

    try {
      // Split multi-fact content (each line starting with "- ") into individual memories
      const facts = content.split('\n')
        .map(line => line.trim().replace(/^-\s*/, '').trim())
        .filter(Boolean);

      for (const fact of facts) {
        const result = await storeWithConsolidation(fact, metadata);
        if (result.type === 'conflict') {
          // In passive extraction mode, log the conflict but auto-override
          console.warn(`[adaptive] add — conflict detected for "${fact.slice(0, 60)}": ${result.conflict?.delta}`);
          await storeWithConsolidation(fact, metadata, true);
        }
      }
    } catch (e: any) {
      console.warn('[adaptive] add error:', e?.message || e);
    }
  }

  /**
   * Extended store method with consolidation control.
   * Used by the explicit store_memory tool (not the passive MemoryBackend.add interface).
   */
  async storeExplicit(content: string, override: boolean = false, metadata: Record<string, any> = {}): Promise<{
    type: 'new' | 'consolidated' | 'conflict';
    memoryId: string;
    conflict?: {
      existingMemory: string;
      existingStrength: number;
      incomingContent: string;
      delta: string;
    };
  }> {
    return storeWithConsolidation(content, metadata, override);
  }

  /**
   * Extended retrieve method with full scoring details.
   * Used by the explicit retrieve_memory tool.
   */
  async retrieveExplicit(query: string, topK: number = 5): Promise<Array<{
    content: string;
    strength: number;
    cosineSimilarity: number;
    finalScore: number;
    retrievalCount: number;
    deltas: string[];
  }>> {
    if (!query.trim()) return [];

    const queryEmbedding = await generateEmbedding(query);
    const results = searchSimilar(queryEmbedding, topK);

    for (const r of results) {
      reinforceMemory(r.record.id);
    }

    return results.map(r => ({
      content: r.record.content,
      strength: r.record.strength,
      cosineSimilarity: r.cosineSimilarity,
      finalScore: r.finalScore,
      retrievalCount: r.record.retrievalCount,
      deltas: r.record.deltas.map(d => d.content),
    }));
  }
}
