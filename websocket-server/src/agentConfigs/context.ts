export type Channel = 'voice' | 'text' | 'sms' | 'email';

export interface Context {
  channel: Channel;
  currentTime: string;
  timeZone: string;
}

export function contextInstructions(context: Context): string {
  let base = `Current communication channel: ${context.channel}. The current time is ${context.currentTime}. The current timezone is ${context.timeZone}.`;
  if (context.channel === 'voice') {
    base += ' When the conversation is over or the caller says goodbye, use the hang_up tool to end the call.';
  }
  return base;
}

// Returns the formatted current time and timezone string.
// If TIMEZONE (IANA, e.g., "Australia/Sydney", "America/Los_Angeles") is set, use it.
// Otherwise, use the server's local time and timezone.
export function getTimeContext(): { currentTime: string; timeZone: string } {
  const envTz = (process.env.TIMEZONE || '').trim();
  const now = new Date();
  if (envTz) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: envTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const currentTime = formatter.format(now).replace(',', '');
    return { currentTime, timeZone: envTz };
  }
  // No TIMEZONE provided: use server local time and server local timezone name if available
  const currentTime = now.toLocaleString();
  let timeZone = 'local';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {}
  return { currentTime, timeZone };
}
