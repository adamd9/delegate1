import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';
dotenv.config();

const config = {
  imap: {
    user: process.env.EMAIL_IMAP_USER || '',
    password: process.env.EMAIL_IMAP_PASSWORD || '',
    host: process.env.EMAIL_IMAP_HOST || '',
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993', 10),
    tls: (process.env.EMAIL_IMAP_TLS || 'true') === 'true',
    authTimeout: 3000
  }
};

const recipientAddress = process.env.EMAIL_DEFAULT_FROM || '';
const processedMailbox = process.env.EMAIL_PROCESSED_MAILBOX;
const isReceivingFilterEnabled = (process.env.EMAIL_RECEIVING_FILTER_ENABLED || 'true') === 'true';

export async function checkInbox() {
  if (!config.imap.user || !config.imap.password || !config.imap.host) {
    console.warn('[checkInbox] Skipping check: IMAP configuration is missing.');
    return [];
  }
  if (!recipientAddress) {
    console.warn('[checkInbox] Skipping check: EMAIL_DEFAULT_FROM is not set.');
    return [];
  }

  let connection: imaps.ImapSimple | null = null;
  try {
    console.log('[checkInbox] Connecting to IMAP server...');
    connection = await imaps.connect(config);
    console.log('[checkInbox] IMAP connection successful.');

    await connection.openBox('INBOX');
    console.log('[checkInbox] Opened INBOX.');

    const searchCriteria: (string | string[])[] = ['UNSEEN'];
    if (isReceivingFilterEnabled && recipientAddress) {
      searchCriteria.push(['TO', recipientAddress]);
      console.log(`[checkInbox] Filtering enabled: searching for emails to ${recipientAddress}.`);
    } else {
      console.log('[checkInbox] Filtering disabled: searching for all unseen emails.');
    }
    const fetchOptions = { bodies: [''], markSeen: true };

    console.log(`[checkInbox] Searching for unseen emails to ${recipientAddress}...`);
    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`[checkInbox] Found ${messages.length} matching emails.`);

    if (!connection) {
      throw new Error('IMAP connection is not available.');
    }
    const imapConnection = connection;

    const emails = await Promise.all(messages.map(async (item) => {
      const all = item.parts.find(part => part.which === '');
      if (!all || !all.body) {
        console.warn('[checkInbox] Email part or body is missing, skipping.');
        return null;
      }

      const uid = item.attributes.uid;
      const mail = await simpleParser(all.body);

      if (processedMailbox) {
        try {
          await imapConnection.moveMessage(uid.toString(), processedMailbox);
          console.log(`[checkInbox] Moved email UID ${uid} to mailbox '${processedMailbox}'.`);
        } catch (moveError) {
          console.warn(`[checkInbox] Could not move email UID ${uid} to mailbox '${processedMailbox}'.`, { error: moveError });
        }
      }

      return {
        from: mail.from?.text,
        subject: mail.subject,
        body: mail.text,
      };
    }));

    // Filter out any nulls from skipped emails
    const validEmails = emails.filter(email => email !== null);
    return validEmails;

  } catch (err) {
    console.error('[checkInbox] IMAP check failed', { err });
    return [];
  } finally {
    if (connection) {
      connection.end();
      console.log('[checkInbox] IMAP connection closed.');
    }
  }
}
