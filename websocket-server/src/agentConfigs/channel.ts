export type Channel = 'voice' | 'text' | 'sms';

export function channelInstructions(channel: Channel): string {
  let base = `Current communication channel: ${channel}.`;
  if (channel === 'voice') {
    base += ' When the conversation is over or the caller says goodbye, use the hang_up tool to end the call.';
  }
  return base;
}
