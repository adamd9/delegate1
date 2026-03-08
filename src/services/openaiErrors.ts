/**
 * Utility helpers for detecting and formatting OpenAI API errors,
 * particularly quota / rate-limit responses (HTTP 429).
 */

export interface OpenAIErrorInfo {
  /** True when the error is an OpenAI quota or rate-limit issue */
  isQuotaOrRateLimit: boolean;
  /** HTTP status code if available */
  status?: number;
  /** OpenAI error code (e.g. 'insufficient_quota', 'rate_limit_exceeded') */
  code?: string;
  /** OpenAI error type */
  errorType?: string;
  /** Human-readable message from the API */
  message: string;
  /** Short user-facing summary suitable for chat / UI display */
  userMessage: string;
}

const QUOTA_CODES = new Set([
  'insufficient_quota',
  'rate_limit_exceeded',
  'billing_hard_limit_reached',
]);

const QUOTA_KEYWORDS = [
  'exceeded your current quota',
  'rate limit',
  'billing',
  'insufficient_quota',
];

/**
 * Inspect an error thrown by the OpenAI Node SDK (or a realtime event error
 * payload) and return structured info.  Works for both REST and WebSocket
 * errors.
 */
export function classifyOpenAIError(err: unknown): OpenAIErrorInfo {
  const status = (err as any)?.status as number | undefined;
  const code = (err as any)?.code ?? (err as any)?.error?.code;
  const errorType = (err as any)?.type ?? (err as any)?.error?.type;
  const message =
    (err as any)?.error?.message ??
    (err as any)?.message ??
    String(err);

  const messageLower = (message || '').toLowerCase();
  const isQuotaOrRateLimit =
    status === 429 ||
    QUOTA_CODES.has(code) ||
    QUOTA_CODES.has(errorType) ||
    QUOTA_KEYWORDS.some((kw) => messageLower.includes(kw));

  let userMessage: string;
  if (isQuotaOrRateLimit) {
    if (code === 'insufficient_quota' || errorType === 'insufficient_quota') {
      userMessage =
        'The OpenAI API quota has been exceeded. Please check the plan and billing details for this API key.';
    } else {
      userMessage =
        'The OpenAI API rate limit has been reached. Please wait a moment and try again.';
    }
  } else {
    userMessage = `An OpenAI API error occurred: ${message}`;
  }

  return { isQuotaOrRateLimit, status, code, errorType, message, userMessage };
}
