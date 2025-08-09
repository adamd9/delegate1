import { randomUUID } from 'crypto';

interface CanvasData {
  content: string;
  title?: string;
  timestamp: number;
}

const canvasStore = new Map<string, CanvasData>();

export function storeCanvas(content: string, title?: string): string {
  const id = randomUUID();
  canvasStore.set(id, { content, title, timestamp: Date.now() });
  return id;
}

export function getCanvas(id: string): CanvasData | undefined {
  return canvasStore.get(id);
}
