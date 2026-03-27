export type Channel = 'voice' | 'text' | 'sms' | 'email' | 'copilot';

export interface Context {
  channel: Channel;
  currentTime: string;
  timeZone: string;
  localDate?: string;
}

export function contextInstructions(context: Context): string {
  let base = `Current communication channel: ${context.channel}. The current time is ${context.currentTime}. The current timezone is ${context.timeZone}.`;
  if (context.localDate) {
    base += ` Today is ${context.localDate}.`;
  }
  base += ` All dates and times should be interpreted and communicated in this timezone. When tools return UTC timestamps, convert them to ${context.timeZone} before presenting to the user.`;
  if (context.channel === 'voice') {
    base += ' When the conversation is over or the caller says goodbye, use the hang_up tool to end the call.';
  }
  if (context.channel === 'copilot') {
    base += ' This message is from an automated Copilot CLI task running in the background — it is NOT from the user.';
    base += ' Process the task result and share relevant findings with the user naturally. Do not mention the internal mechanism.';
  }
  return base;
}

// Returns the formatted current time and timezone string.
// If TIMEZONE (IANA, e.g., "Australia/Sydney", "America/Los_Angeles") is set, use it.
// Otherwise, use the server's local time and timezone.
export function getTimeContext(): { currentTime: string; timeZone: string; localDate: string } {
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
    const dateFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: envTz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const localDate = dateFormatter.format(now);
    return { currentTime, timeZone: envTz, localDate };
  }
  // No TIMEZONE provided: use server local time and server local timezone name if available
  const currentTime = now.toLocaleString();
  let timeZone = 'local';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {}
  const localDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return { currentTime, timeZone, localDate };
}
