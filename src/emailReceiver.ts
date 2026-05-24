import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { configService } from './config';

function buildImapConfig() {
  return {
    imap: {
      user: configService.get('EMAIL_IMAP_USER') || configService.get('EMAIL_SMTP_USER') || '',
      password: configService.get('EMAIL_IMAP_PASSWORD') || configService.get('EMAIL_SMTP_PASS') || '',
      host: configService.get('EMAIL_IMAP_HOST') || '',
      port: parseInt(configService.get('EMAIL_IMAP_PORT') || '993', 10),
      tls: (configService.get('EMAIL_IMAP_TLS') || 'true') === 'true',
      authTimeout: 3000,
    },
  };
}

export async function checkInbox() {
  // Read config fresh on every poll so settings changes take effect without restart
  const imapConfig = buildImapConfig();
  const agentAddress = (configService.get('EMAIL_DEFAULT_FROM') || '').trim();
  const processedMailbox = configService.get('EMAIL_PROCESSED_MAILBOX');
  const isReceivingFilterEnabled = (configService.get('EMAIL_RECEIVING_FILTER_ENABLED') || 'true') === 'true';

  if (!imapConfig.imap.user || !imapConfig.imap.password || !imapConfig.imap.host) {
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
    connection = await imaps.connect(imapConfig);
    connection.on('error', logImapError);
    const rawConnection = (connection as unknown as { imap?: { on?: (event: string, handler: (err: unknown) => void) => void } }).imap;
    rawConnection?.on?.('error', logImapError);

    await connection.openBox('INBOX');

    const searchCriteria: (string | string[])[] = ['UNSEEN'];
    if (isReceivingFilterEnabled) {
      if (agentAddress) {
        searchCriteria.push(['TO', agentAddress]);
      } else {
        console.warn('[checkInbox] Filter Inbound is enabled but EMAIL_DEFAULT_FROM (Agent Email Address) is not set — falling back to processing all unread mail');
      }
    }
    const fetchOptions = { bodies: [''], markSeen: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

    if (!connection) {
      throw new Error('IMAP connection is not available.');
    }
    const imapConnection = connection;

    // Belt-and-braces: IMAP TO search is a header substring match and some
    // providers index it loosely. Do an explicit in-process check too so we
    // never act on something not actually addressed to the agent.
    const acceptMessage = (mail: { to?: { text?: string } | Array<{ text?: string }>; cc?: { text?: string } | Array<{ text?: string }> }): boolean => {
      if (!isReceivingFilterEnabled || !agentAddress) return true;
      const target = agentAddress.toLowerCase();
      const collect = (field: typeof mail.to): string[] => {
        if (!field) return [];
        if (Array.isArray(field)) return field.map((f) => (f.text || '').toLowerCase());
        return [(field.text || '').toLowerCase()];
      };
      const addrs = [...collect(mail.to), ...collect(mail.cc)];
      return addrs.some((a) => a.includes(target));
    };

    const emails = await Promise.all(messages.map(async (item) => {
      const all = item.parts.find(part => part.which === '');
      if (!all || !all.body) {
        console.warn('[checkInbox] Email part or body is missing, skipping.');
        return null;
      }

      const uid = item.attributes.uid;
      const mail = await simpleParser(all.body);

      if (!acceptMessage(mail as any)) {
        console.log(`[checkInbox] Skipping UID ${uid} — not addressed to ${agentAddress} (to: "${(mail.to as any)?.text || ''}")`);
        return null;
      }

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
