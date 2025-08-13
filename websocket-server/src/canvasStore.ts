import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface CanvasData {
  content: string;
  title?: string;
  timestamp: number;
}

const CANVAS_DIR = path.join(__dirname, '..', 'canvas-artifacts');

async function ensureDir() {
  await fs.mkdir(CANVAS_DIR, { recursive: true });
}

export async function storeCanvas(content: string, title?: string): Promise<string> {
  const id = randomUUID();
  await ensureDir();
  const data: CanvasData = { content, title, timestamp: Date.now() };
  await fs.writeFile(path.join(CANVAS_DIR, `${id}.json`), JSON.stringify(data), 'utf-8');
  return id;
}

export async function getCanvas(id: string): Promise<CanvasData | undefined> {
  try {
    const file = await fs.readFile(path.join(CANVAS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(file) as CanvasData;
  } catch {
    return undefined;
  }
}
