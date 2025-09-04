// Centralized, minimal email state (single-user assumption)
let currentReplyTo: string | null = null;

/**
 * Sets the email address to which replies should be sent.
 * This is typically the 'from' address of an incoming email.
 */
export function setReplyTo(address: string) {
  if (!address) {
    console.warn('[EmailState] Attempted to set an empty reply-to address.');
    return;
  }
  console.log(`[EmailState] Setting reply-to address to: ${address}`);
  currentReplyTo = address;
}

/**
 * Gets the email address for the current reply.
 */
export function getReplyTo(): string | null {
  return currentReplyTo;
}

/**
 * Clears the current reply-to address.
 */
export function clearReplyTo() {
  console.log('[EmailState] Clearing reply-to address.');
  currentReplyTo = null;
}
