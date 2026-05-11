import type { Channel } from '../agentConfigs/context';
import { handleTextChatMessage, type ChatMetadata, type ChatResult } from '../session/chat';
import { chatClients, logsClients } from '../ws/clients';

export type InjectMessageParams = {
  message: string;
  channel: Channel;
  metadata?: ChatMetadata;
  opts?: {
    conversationId?: string;
    internal?: boolean;
  };
};

export async function injectMessage({
  message,
  channel,
  metadata = {},
  opts = {},
}: InjectMessageParams): Promise<ChatResult | undefined> {
  return handleTextChatMessage(message, chatClients, logsClients, channel, metadata, opts);
}
