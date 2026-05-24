import { WebSocket } from 'ws';
import { checkInbox } from './emailReceiver';
import { handleTextChatMessage } from './session/chat';
import { setReplyTo } from './emailState';
import { configService } from './config';

const POLLING_INTERVAL_MS = 30000; // 30 seconds

let pollTimer: NodeJS.Timeout | null = null;
let activeChatClients: Set<WebSocket> | null = null;
let activeLogsClients: Set<WebSocket> | null = null;

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

function emailReceivingEnabled(): boolean {
  // Polling only makes sense if we at least have a host + user configured
  return !!(configService.get('EMAIL_IMAP_HOST') && (configService.get('EMAIL_IMAP_USER') || configService.get('EMAIL_SMTP_USER')));
}

export function startEmailPolling(chatClients: Set<WebSocket>, logsClients: Set<WebSocket>) {
  activeChatClients = chatClients;
  activeLogsClients = logsClients;

  if (pollTimer) {
    console.log('[EmailPoller] Already running — ignoring duplicate start');
    return;
  }

  if (!emailReceivingEnabled()) {
    console.log('[EmailPoller] No IMAP credentials configured — polling not started');
    return;
  }

  console.log('[EmailPoller] Starting email polling...');
  const poll = () => processNewEmails(chatClients, logsClients).catch(err => console.error('[EmailPoller] Error during polling:', err));

  pollTimer = setInterval(poll, POLLING_INTERVAL_MS);
  // Run once immediately on start
  poll();
}

export function stopEmailPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[EmailPoller] Stopped');
  }
}

/**
 * Tear down and re-start polling so any changed IMAP credentials take effect.
 * Re-uses the chat/logs client sets captured by the original startEmailPolling call.
 */
export function reinitEmailPolling(): { ok: boolean; message?: string } {
  if (!activeChatClients || !activeLogsClients) {
    return { ok: false, message: 'Email polling has not been started yet — nothing to reinit' };
  }
  stopEmailPolling();
  startEmailPolling(activeChatClients, activeLogsClients);
  return {
    ok: true,
    message: emailReceivingEnabled()
      ? 'Email polling restarted with new credentials'
      : 'Email polling stopped — no IMAP credentials configured',
  };
}

