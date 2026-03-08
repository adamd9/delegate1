/**
 * Returns the backend base URL.
 * When NEXT_PUBLIC_REMOTE_BACKEND is set, returns that (useful for pointing at
 * a separate backend during development or cross-origin testing).
 * When unset, returns '' so all fetch calls use relative URLs — correct for
 * the consolidated single-process deployment where frontend and backend are
 * the same server.
 */
export function getBackendUrl(): string {
  return process.env.NEXT_PUBLIC_REMOTE_BACKEND || '';
}

/**
 * Returns an absolute WebSocket URL.
 * When no backend URL is configured (same-origin mode), derives host and
 * protocol from window.location so it works on any hostname/port.
 */
export function getWebSocketUrl(path: string): string {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    // Same-origin: derive from the current page URL
    if (typeof window !== 'undefined') {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      return `${wsProtocol}${window.location.host}${path}`;
    }
    // SSR / build-time fallback (should not be reached in static export)
    return `ws://localhost:8081${path}`;
  }
  const wsProtocol = backendUrl.startsWith('https://') ? 'wss://' : 'ws://';
  const hostWithPath = backendUrl.replace(/^https?:\/\//, '') + path;
  return `${wsProtocol}${hostWithPath}`;
}
