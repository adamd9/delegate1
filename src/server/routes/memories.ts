import type { Application, Request, Response } from 'express';
import { getMemoryConfig } from '../../memory/memoryConfig';
import { getMemoryBackend } from '../../memory/backends';
import { AdaptiveMemoryBackend } from '../../memory/backends/adaptive';
import { listMemoriesSummary, deleteMemory, countMemories } from '../../memory/backends/adaptive/vectorStore';

export function registerMemoriesRoutes(app: Application) {
  /**
   * GET /api/memories
   * List all saved memories. Only supported for the Adaptive backend.
   */
  app.get('/api/memories', (_req: Request, res: Response) => {
    try {
      const config = getMemoryConfig();
      const backend = getMemoryBackend();

      if (config.backend !== 'adaptive' || !(backend instanceof AdaptiveMemoryBackend)) {
        return res.json({
          supported: false,
          backend: config.backend,
          message: 'Memory browsing is only available with the Adaptive backend.',
          memories: [],
          count: 0,
        });
      }

      const memories = listMemoriesSummary();
      res.json({
        supported: true,
        backend: 'adaptive',
        count: memories.length,
        memories,
      });
    } catch (err: any) {
      console.error('[memories] GET error', err);
      res.status(500).json({ error: err?.message || 'Failed to list memories' });
    }
  });

  /**
   * DELETE /api/memories/:id
   * Delete a single memory by ID. Only supported for the Adaptive backend.
   */
  app.delete('/api/memories/:id', (req: Request, res: Response) => {
    try {
      const config = getMemoryConfig();
      if (config.backend !== 'adaptive') {
        return res.status(400).json({ error: 'Delete is only supported with the Adaptive backend.' });
      }

      const id = req.params.id;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing memory ID' });

      deleteMemory(id);
      console.log(`[memories] deleted memory ${id}`);
      res.json({ status: 'ok', deleted: id });
    } catch (err: any) {
      console.error('[memories] DELETE error', err);
      res.status(500).json({ error: err?.message || 'Failed to delete memory' });
    }
  });
}
