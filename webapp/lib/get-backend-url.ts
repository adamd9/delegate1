/**
 * Returns the backend URL from environment variable or falls back to localhost
 */
export function getBackendUrl(): string {
  return process.env.NEXT_PUBLIC_REMOTE_BACKEND || 'http://localhost:8081';
}

/**
 * Returns the WebSocket URL with the appropriate protocol (ws:// or wss://)
 * based on the backend URL protocol
 */
export function getWebSocketUrl(path: string): string {
  const backendUrl = getBackendUrl();
  const wsProtocol = backendUrl.startsWith('https://') ? 'wss://' : 'ws://';
  const hostWithPath = backendUrl.replace(/^https?:\/\//, '') + path;
  return `${wsProtocol}${hostWithPath}`;
}
