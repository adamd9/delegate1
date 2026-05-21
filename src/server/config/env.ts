import { configService } from '../../config';

export interface AppConfig {
  port: number;
  publicUrlRaw: string;
  effectivePublicUrl: string;
  openaiApiKey: string;
  sessionHistoryLimit: number;
}

export function getPort(): number {
  return parseInt(process.env.PORT || '8081', 10);
}

export function getPublicUrlRaw(): string {
  return configService.get('PUBLIC_URL') || '';
}

export function getEffectivePublicUrl(): string {
  const publicUrlRaw = getPublicUrlRaw();
  const port = getPort();
  return (publicUrlRaw && publicUrlRaw.trim()) || `http://localhost:${port}`;
}

export function getSessionHistoryLimit(): number {
  const raw = configService.get('SESSION_HISTORY_LIMIT');
  const parsed = Number(raw);
  const fallback = 3;
  const limit = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(50, Math.max(1, limit));
}

export function isItemsDebugEnabled(): boolean {
  return (configService.get('ITEMS_DEBUG') || '').toLowerCase() === 'true';
}

export function getConfig(): AppConfig {
  const port = getPort();
  const publicUrlRaw = getPublicUrlRaw();
  const effectivePublicUrl = getEffectivePublicUrl();
  const openaiApiKey = configService.get('OPENAI_API_KEY') || '';
  const sessionHistoryLimit = getSessionHistoryLimit();

  return {
    port,
    publicUrlRaw,
    effectivePublicUrl,
    openaiApiKey,
    sessionHistoryLimit,
  };
}
