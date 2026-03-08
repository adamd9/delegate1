import { promises as fs } from 'fs';
import path from 'path';

export type AdaptationScope = {
  agents?: Array<'base' | 'supervisor'>;
  channels?: Array<'text' | 'voice' | 'sms' | 'email'>;
  global?: boolean;
};

export interface AdaptationItem {
  id: string;             // stable id, fixed set
  title: string;
  content: string;
  scope: AdaptationScope; // which agent/channel it applies to
  tags?: string[];
  enabled?: boolean;      // default true
  description?: string;   // non-editable metadata: where/when this is applied
}

export async function getAdaptationTextById(id: string): Promise<{ id: string; text: string; enabled: boolean; version: number } | undefined> {
  if (!cachedEdits) cachedEdits = await readEdits();
  const items = resolveItems(cachedEdits);
  const item = items.find((i) => i.id === id);
  if (!item) return undefined;
  const enabled = item.enabled ?? true;
  const text = enabled ? (item.content || '').trim() : '';
  return { id, text, enabled, version: cacheVersion };
}

export interface AdaptationEdit {
  title?: string;
  content?: string;
  enabled?: boolean;
  updated_at?: number;
  // Non-editable doc copy written from skeleton for human readability in JSON
  description?: string;
}

// Use absolute path from env var if set, otherwise fall back to relative path for dev
const RUNTIME_DIR = process.env.RUNTIME_DATA_DIR
  ? path.resolve(process.env.RUNTIME_DATA_DIR)
  : path.join(__dirname, '..', 'runtime-data');
const EDITS_FILE = path.join(RUNTIME_DIR, 'adaptations.edits.json');

// Code-defined skeleton of known adaptation identifiers and metadata.
// Keep content empty and disabled by default; actual content lives in edits.
const ADAPTATION_SKELETON: AdaptationItem[] = [
  // Dedicated insertion point for core text chat prompt assembly in handleTextChatMessage
  {
    id: 'adn.prompt.core.handleText',
    title: 'Core text prompt adaptation (handleTextChatMessage)',
    description: 'Injected in chat.ts handleTextChatMessage() between context.preamble and base policy; recorded as prompt.adaptations step with adaptation_id.',
    content: '',
    scope: { agents: ['base'], channels: ['text'], global: false },
    tags: ['core', 'text'],
    enabled: false,
  },
  // Confirmation stage after a tool call (e.g., canvas sent) in functionCallExecutor
  {
    id: 'adn.prompt.core.toolConfirm',
    title: 'Tool confirmation prompt adaptation',
    description: 'Used in functionCallExecutor confirmation Responses call after a tool is executed; emits prompt.adaptations (confirmation stage).',
    content: '',
    scope: { agents: ['base'], channels: ['text'], global: true },
    tags: ['core', 'confirm'],
    enabled: false,
  },
  // Supervisor initial request adaptation
  {
    id: 'adn.prompt.supervisor.initial',
    title: 'Supervisor initial prompt adaptation',
    description: 'Prepended to the supervisor initial Responses request instructions; emits prompt.adaptations (supervisor initial).',
    content: '',
    scope: { agents: ['supervisor'], global: true },
    tags: ['supervisor'],
    enabled: false,
  },
  // Supervisor follow-up request adaptation (after tool outputs)
  {
    id: 'adn.prompt.supervisor.followup',
    title: 'Supervisor follow-up prompt adaptation',
    description: 'Added as instructions to supervisor follow-up Responses request after tool outputs; emits prompt.adaptations (supervisor follow-up).',
    content: '',
    scope: { agents: ['supervisor'], global: true },
    tags: ['supervisor'],
    enabled: false,
  },
];

let cacheVersion = 1;
let cachedEdits: Record<string, AdaptationEdit> | null = null;

async function readEdits(): Promise<Record<string, AdaptationEdit>> {
  // Ensure the edits file exists; if not, create a skeleton based on known identifiers.
  try {
    // Ensure runtime directory exists
    try { await fs.mkdir(RUNTIME_DIR, { recursive: true }); } catch {}
    const txt = await fs.readFile(EDITS_FILE, 'utf-8');
    const parsed = JSON.parse(txt) as Record<string, AdaptationEdit> | undefined;
    const base: Record<string, AdaptationEdit> = parsed && typeof parsed === 'object' ? parsed : {};
    // Merge any missing skeleton IDs into the existing edits (non-destructive)
    let changed = false;
    for (const sk of ADAPTATION_SKELETON) {
      if (!base[sk.id]) {
        base[sk.id] = { title: sk.title, content: '', enabled: false, description: sk.description, updated_at: Date.now() };
        changed = true;
      } else {
        // Ensure description exists for readability (do not override if user added custom doc)
        if (!base[sk.id].description && sk.description) {
          base[sk.id].description = sk.description;
          changed = true;
        }
      }
    }
    if (changed) {
      await fs.writeFile(EDITS_FILE, JSON.stringify(base, null, 2), 'utf-8');
    }
    return base;
  } catch {
    const skeleton: Record<string, AdaptationEdit> = {};
    for (const sk of ADAPTATION_SKELETON) {
      skeleton[sk.id] = { title: sk.title, content: '', enabled: false, description: sk.description, updated_at: Date.now() };
    }
    try { await fs.mkdir(RUNTIME_DIR, { recursive: true }); } catch {}
    await fs.writeFile(EDITS_FILE, JSON.stringify(skeleton, null, 2), 'utf-8');
    return skeleton;
  }
}

async function writeEdits(edits: Record<string, AdaptationEdit>) {
  try { await fs.mkdir(RUNTIME_DIR, { recursive: true }); } catch {}
  await fs.writeFile(EDITS_FILE, JSON.stringify(edits, null, 2), 'utf-8');
}

function resolveItems(edits: Record<string, AdaptationEdit>): AdaptationItem[] {
  // Resolve from skeleton + edits; do not include any opinionated defaults.
  return ADAPTATION_SKELETON.map((d) => {
    const e = edits[d.id] || {};
    return {
      ...d,
      title: e.title ?? d.title,
      content: e.content ?? d.content,
      enabled: e.enabled ?? d.enabled ?? false,
      description: d.description,
    } as AdaptationItem;
  });
}

function matchesScope(item: AdaptationItem, agent: 'base' | 'supervisor', channel: 'text' | 'voice' | 'sms' | 'email'): boolean {
  const { scope } = item;
  if (scope.global) return true;
  if (scope.agents && scope.agents.length > 0 && !scope.agents.includes(agent)) return false;
  if (scope.channels && scope.channels.length > 0 && !scope.channels.includes(channel)) return false;
  return true;
}

export async function getAdaptationsText(
  params: { agent: 'base' | 'supervisor'; channel: 'text' | 'voice' | 'sms' | 'email' }
): Promise<{ text: string; includedIds: string[]; version: number }> {
  if (!cachedEdits) cachedEdits = await readEdits();
  const items = resolveItems(cachedEdits)
    .filter((it) => (it.enabled ?? true))
    .filter((it) => matchesScope(it, params.agent, params.channel));
  const includedIds = items.map((it) => it.id);
  const text = items.map((it) => it.content.trim()).filter(Boolean).join('\n');
  return { text, includedIds, version: cacheVersion };
}

export async function listAdaptations(filter?: {
  agent?: 'base' | 'supervisor';
  channel?: 'text' | 'voice' | 'sms' | 'email';
  tags?: string[];
  enabled?: boolean;
}): Promise<AdaptationItem[]> {
  if (!cachedEdits) cachedEdits = await readEdits();
  let items = resolveItems(cachedEdits);
  if (typeof filter?.enabled === 'boolean') items = items.filter((i) => (i.enabled ?? true) === filter.enabled);
  if (filter?.tags && filter.tags.length > 0) items = items.filter((i) => i.tags?.some((t) => filter.tags!.includes(t)));
  if (filter?.agent && filter?.channel) items = items.filter((i) => matchesScope(i, filter.agent!, filter.channel!));
  return items;
}

export async function getAdaptation(id: string): Promise<AdaptationItem | undefined> {
  if (!cachedEdits) cachedEdits = await readEdits();
  const items = resolveItems(cachedEdits);
  return items.find((i) => i.id === id);
}

export async function updateAdaptation(
  id: string,
  updates: AdaptationEdit
): Promise<AdaptationItem | undefined> {
  // Ensure id exists in defaults
  const exists = ADAPTATION_SKELETON.some((d) => d.id === id);
  if (!exists) return undefined;
  if (!cachedEdits) cachedEdits = await readEdits();
  const next = { ...(cachedEdits || {}) };
  next[id] = { ...(next[id] || {}), ...updates, updated_at: Date.now() };
  await writeEdits(next);
  cachedEdits = next;
  cacheVersion++;
  return getAdaptation(id);
}

export async function reloadAdaptations(): Promise<{ version: number }> {
  cachedEdits = await readEdits();
  cacheVersion++;
  return { version: cacheVersion };
}
