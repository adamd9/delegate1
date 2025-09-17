export interface AppConfig {
  port: number;
  publicUrlRaw: string;
  effectivePublicUrl: string;
  openaiApiKey: string;
  sessionHistoryLimit: number;
}

export function getConfig(): AppConfig {
  const port = parseInt(process.env.PORT || '8081', 10);
  const publicUrlRaw = process.env.PUBLIC_URL || '';
  const effectivePublicUrl = (publicUrlRaw && publicUrlRaw.trim()) || `http://localhost:${port}`;
  const openaiApiKey = process.env.OPENAI_API_KEY || '';
  const sessionHistoryLimit = parseInt(process.env.SESSION_HISTORY_LIMIT || '3', 10);

  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  return {
    port,
    publicUrlRaw,
    effectivePublicUrl,
    openaiApiKey,
    sessionHistoryLimit,
  };
}
