import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
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

function loadBuildInfo(): BuildInfo {
  // Try reading a CI-generated build-info.json first (production).
  const filePath = path.resolve(__dirname, '..', '..', 'build-info.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.commitId && data.commitId !== 'unknown') {
      return {
        commitId: data.commitId ?? 'unknown',
        commitMessage: data.commitMessage ?? 'unknown',
        branch: data.branch ?? 'unknown',
        buildTime: data.buildTime ?? new Date().toISOString(),
      };
    }
  } catch {
    // File missing or invalid — fall through to git.
  }

  // Fall back to live git commands (local development).
  return {
    commitId: git('git rev-parse --short HEAD'),
    commitMessage: git('git log -1 --format=%s'),
    branch: git('git rev-parse --abbrev-ref HEAD'),
    buildTime: new Date().toISOString(),
  };
}

// Resolve once at import time so we never shell out per-request.
const buildInfo: BuildInfo = loadBuildInfo();

export function registerBuildInfoRoutes(app: Application) {
  app.get('/build-info.json', (_req: Request, res: Response) => {
    res.json(buildInfo);
  });
}
