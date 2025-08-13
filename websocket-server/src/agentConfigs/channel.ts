export type Channel = 'voice' | 'text' | 'sms';

export function channelInstructions(channel: Channel): string {
  return `Current communication channel: ${channel}.`;
}
