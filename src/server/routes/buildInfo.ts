import { execSync } from 'child_process';
import type { Application, Request, Response } from 'express';

interface BuildInfo {
  commitId: string;
  commitMessage: string;
  branch: string;
  buildTime: string;
}

function git(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

// Resolve once at import time so we never shell out per-request.
const buildInfo: BuildInfo = {
  commitId: git('git rev-parse --short HEAD'),
  commitMessage: git('git log -1 --format=%s'),
  branch: git('git rev-parse --abbrev-ref HEAD'),
  buildTime: new Date().toISOString(),
};

export function registerBuildInfoRoutes(app: Application) {
  app.get('/build-info.json', (_req: Request, res: Response) => {
    res.json(buildInfo);
  });
}
