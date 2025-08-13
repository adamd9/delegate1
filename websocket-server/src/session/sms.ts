import { WebSocket } from "ws";
import { openReplyWindow, setNumbers } from "../smsState";
import { handleTextChatMessage } from "./chat";

// Normalize SMS webhook into the unified chat pipeline
// - Records phone numbers for reply routing via `smsState`
// - Ensures the reply window is open
// - Forwards the inbound text to the chat handler
export async function processSmsWebhook(
  params: { messageText: string; from: string; to: string },
  chatClients: Set<WebSocket>,
  logsClients: Set<WebSocket>
) {
  const { messageText, from, to } = params;
  try {
    setNumbers({ userFrom: from, twilioTo: to });
    openReplyWindow();
  } catch (e) {
    console.warn('⚠️ SMS setup warning:', e);
  }
  await handleTextChatMessage(messageText, chatClients, logsClients, 'sms');
}
