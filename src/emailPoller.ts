import { WebSocket } from 'ws';
import { checkInbox } from './emailReceiver';
import { handleTextChatMessage } from './session/chat';
import { setReplyTo } from './emailState';

const POLLING_INTERVAL_MS = 30000; // 30 seconds

async function processNewEmails(chatClients: Set<WebSocket>, logsClients: Set<WebSocket>) {
  const emails = await checkInbox();

  if (emails.length > 0) {
    console.log(`[EmailPoller] Found ${emails.length} new emails.`);
    for (const email of emails) {
      if (!email || !email.from || !email.body) continue;

      try {
        // Set the reply-to address for this conversation thread
        setReplyTo(email.from);

        // Format the email content for the agent
        const messageContent = `Subject: ${email.subject || 'No Subject'}\n\n${email.body}`;

        // Process the email content as a new chat message
        await handleTextChatMessage(messageContent, chatClients, logsClients, 'email', { subject: email.subject });
        console.log(`[EmailPoller] Processed email from ${email.from} as a chat message.`);

      } catch (err) {
        console.error(`[EmailPoller] Failed to process email from ${email.from}`, { err });
      }
    }
  }
}

export function startEmailPolling(chatClients: Set<WebSocket>, logsClients: Set<WebSocket>) {
  console.log('[EmailPoller] Starting email polling...');
  const poll = () => processNewEmails(chatClients, logsClients).catch(err => console.error('[EmailPoller] Error during polling:', err));
  
  setInterval(poll, POLLING_INTERVAL_MS);
  // Run once immediately on start
  poll();
}

