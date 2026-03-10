import type { MemoryBackend } from '../types';

// Cache the client instance — dynamic import + construction only happens once
let _client: any = null;

async function getClient() {
  if (_client) return _client;
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) throw new Error('MEM0_API_KEY is not set');
  const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  let mod: any;
  try { mod = await dynImport('mem0ai'); }
  catch {
    try { mod = await dynImport('@mem0ai/mem0'); }
    catch { throw new Error("Mem SDK not installed. Install 'mem0ai' or '@mem0ai/mem0' in websocket-server"); }
  }
  const MemoryClient = mod?.default || mod?.MemoryClient || mod;
  const host = process.env.MEM0_API_HOST;
  _client = host ? new MemoryClient({ apiKey, host }) : new MemoryClient({ apiKey });
  console.log('[memory:mem0] client initialised');
  return _client;
}

export class Mem0Backend implements MemoryBackend {
  readonly available: boolean;

  constructor() {
    this.available = Boolean(process.env.MEM0_API_KEY);
  }

  async retrieve(query: string, limit = 5): Promise<string | null> {
    if (!this.available) return null;
    try {
      const client = await getClient();
      console.log(`[memory:mem0] search → user_id=global limit=${limit}`);
      const t = Date.now();
      const results = await client.search(query, { user_id: 'global', limit });
      console.log(`[memory:mem0] search ← ${Date.now() - t}ms raw:`, JSON.stringify(results)?.slice(0, 200));
      if (!results || !Array.isArray(results) || results.length === 0) return null;
      const lines = results
        .map((r: any) => r?.memory || r?.text || r?.content)
        .filter(Boolean)
        .map((m: string) => `- ${m}`);
      return lines.length ? lines.join('\n') : null;
    } catch (e: any) {
      console.warn('[memory:mem0] retrieve error:', e?.message || e);
      return null;
    }
  }

  async add(content: string, metadata?: Record<string, any>): Promise<void> {
    if (!this.available) return;
    try {
      const client = await getClient();
      const messages = [{ role: 'user', content }];
      const options: any = { user_id: 'global' };
      if (metadata && Object.keys(metadata).length) options.metadata = metadata;
      console.log(`[memory:mem0] add → ${content.slice(0, 100)}${content.length > 100 ? '…' : ''}`);
      const t = Date.now();
      await client.add(messages, options);
      console.log(`[memory:mem0] add ← ${Date.now() - t}ms`);
    } catch (e: any) {
      console.warn('[memory:mem0] add error:', e?.message || e);
    }
  }
}
