import { getBackendUrl } from './get-backend-url';

export type AdaptationItem = {
  id: string;
  title: string;
  content: string;
  enabled?: boolean;
  scope: {
    agents?: Array<'base' | 'supervisor'>;
    channels?: Array<'text' | 'voice' | 'sms' | 'email'>;
    global?: boolean;
  };
  tags?: string[];
};

export async function fetchAdaptations(params?: { agent?: string; channel?: string; enabled?: boolean; tags?: string[] }) {
  const url = new URL(getBackendUrl() + '/api/adaptations');
  if (params?.agent) url.searchParams.set('agent', params.agent);
  if (params?.channel) url.searchParams.set('channel', params.channel);
  if (typeof params?.enabled === 'boolean') url.searchParams.set('enabled', String(params.enabled));
  if (params?.tags && params.tags.length) url.searchParams.set('tags', params.tags.join(','));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchAdaptations failed: ${res.status}`);
  const data = await res.json();
  return data.items as AdaptationItem[];
}

export async function fetchAdaptation(id: string) {
  const res = await fetch(getBackendUrl() + `/api/adaptations/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchAdaptation failed: ${res.status}`);
  const data = await res.json();
  return data.item as AdaptationItem;
}

export async function updateAdaptation(id: string, updates: { title?: string; content?: string; enabled?: boolean }) {
  const res = await fetch(getBackendUrl() + `/api/adaptations/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`updateAdaptation failed: ${res.status}`);
  const data = await res.json();
  return data.item as AdaptationItem;
}

export async function reloadAdaptations() {
  const res = await fetch(getBackendUrl() + '/api/adaptations.reload', { method: 'POST' });
  if (!res.ok) throw new Error(`reloadAdaptations failed: ${res.status}`);
  return res.json();
}
