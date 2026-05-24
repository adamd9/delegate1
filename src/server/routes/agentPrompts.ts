import type { Application, Request, Response } from 'express';
import { DEFAULT_AGENT_PERSONALITY, DEFAULT_AGENT_INSTRUCTIONS } from '../../agentConfigs/prompts';

/**
 * Read-only endpoint that exposes the compiled-in default prompts so the
 * settings UI can offer a "Reset to default" button that fills the textarea
 * with the canonical default verbatim (without baking it into the client).
 */
export function registerAgentPromptDefaultsRoute(app: Application) {
  app.get('/api/agent-prompts/defaults', (_req: Request, res: Response) => {
    res.json({
      AGENT_PERSONALITY: DEFAULT_AGENT_PERSONALITY,
      AGENT_INSTRUCTIONS: DEFAULT_AGENT_INSTRUCTIONS,
    });
  });
}
