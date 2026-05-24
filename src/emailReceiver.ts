import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';
import { configService } from './config';
dotenv.config();

const config = {
  imap: {
    user: configService.get('EMAIL_IMAP_USER') || configService.get('EMAIL_SMTP_USER') || '',
    password: configService.get('EMAIL_IMAP_PASSWORD') || configService.get('EMAIL_SMTP_PASS') || '',
    host: configService.get('EMAIL_IMAP_HOST') || '',
    port: parseInt(configService.get('EMAIL_IMAP_PORT') || '993', 10),
    tls: (configService.get('EMAIL_IMAP_TLS') || 'true') === 'true',
    authTimeout: 3000
  }
};

const recipientAddress = configService.get('EMAIL_DEFAULT_TO') || '';
const processedMailbox = configService.get('EMAIL_PROCESSED_MAILBOX');
const isReceivingFilterEnabled = (configService.get('EMAIL_RECEIVING_FILTER_ENABLED') || 'true') === 'true';

export async function checkInbox() {
  if (!config.imap.user || !config.imap.password || !config.imap.host) {
    return [];
  }
  if (!recipientAddress) {
    return [];
  }

  let connection: imaps.ImapSimple | null = null;
  const logImapError = (error: unknown) => {
    const err = error as { code?: string; message?: string };
    const isTimeout = err?.code === 'ETIMEDOUT';
    const level = isTimeout ? console.warn : console.error;
    level('[checkInbox] IMAP connection error', { error });
  };
  try {
    connection = await imaps.connect(config);
    connection.on('error', logImapError);
    const rawConnection = (connection as unknown as { imap?: { on?: (event: string, handler: (err: unknown) => void) => void } }).imap;
    rawConnection?.on?.('error', logImapError);

    await connection.openBox('INBOX');

    const searchCriteria: (string | string[])[] = ['UNSEEN'];
    if (isReceivingFilterEnabled && recipientAddress) {
      searchCriteria.push(['TO', recipientAddress]);
    }
    const fetchOptions = { bodies: [''], markSeen: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

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
    const error = err as { code?: string; message?: string };
    const isTimeout = error?.code === 'ETIMEDOUT' || (error?.message && error.message.includes('timed out'));
    const level = isTimeout ? console.warn : console.error;
    level(`[checkInbox] IMAP check failed: ${error?.message || err}`);
    return [];
  } finally {
    if (connection) {
      try {
        connection.end();
      } catch (err) {
        console.warn('[checkInbox] IMAP connection close failed', { err });
      }
    }
  }
}
