import type { Channel } from '../agentConfigs/context';

export interface MemorySearchResult {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, any>;
}

export interface CompletedTurn {
  userContent: string;
  assistantContent: string;
  channel: Channel;
  conversationId: string;
}

export interface CompletedConversation {
  conversationId: string;
  channel: Channel;
  turns: Array<{ role: 'user' | 'assistant'; text: string }>;
}

/** Swappable backend interface — implement this to add a new memory provider */
export interface MemoryBackend {
  /** Semantic search; returns formatted string of results, or null if nothing found / unavailable */
  retrieve(query: string, limit?: number): Promise<string | null>;
  /** Store content (already-extracted facts as plain text) */
  add(content: string, metadata?: Record<string, any>): Promise<void>;
  /** True if the backend is configured and ready */
  readonly available: boolean;
}
