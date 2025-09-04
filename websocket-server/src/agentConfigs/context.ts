export type Channel = 'voice' | 'text' | 'sms';

export interface Context {
  channel: Channel;
  currentTime: string;
}

export function contextInstructions(context: Context): string {
  let base = `Current communication channel: ${context.channel}. The current time is ${context.currentTime}.`;
  if (context.channel === 'voice') {
    base += ' When the conversation is over or the caller says goodbye, use the hang_up tool to end the call.';
  }
  return base;
}
