/**
 * Returns the backend URL from environment variable or falls back to localhost
 */
export function getBackendUrl(): string {
  return process.env.REMOTE_BACKEND || 'http://localhost:8081';
}
