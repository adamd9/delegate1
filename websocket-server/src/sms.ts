import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

export async function sendSms(text: string, from: string, to: string) {
  const accountSid = process.env.TWILIO_SMS_ACCOUNT_SID;
  const authToken = process.env.TWILIO_SMS_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  console.debug('[sendSms] Inputs', {
    hasText: Boolean(text && text.trim().length),
    from,
    to,
    hasAccountSid: Boolean(accountSid),
    hasAuthToken: Boolean(authToken),
    hasMessagingServiceSid: Boolean(messagingServiceSid),
  });
  if (!accountSid || !authToken) {
    console.warn('[sendSms] Skipping send: Twilio credentials missing');
    return;
  }
  if (!text?.trim() || !to) {
    console.warn('[sendSms] Skipping send: missing text or to', { text, from, to });
    return;
  }
  const twilioClient = twilio(accountSid, authToken);
  try {
    // Prefer explicit From when available; otherwise fall back to Messaging Service SID if configured
    if (from) {
      console.debug('[sendSms] Sending via explicit From');
      await twilioClient.messages.create({ body: text, from, to });
      console.info('[sendSms] Sent via From');
    } else if (messagingServiceSid) {
      console.debug('[sendSms] Sending via Messaging Service SID');
      await twilioClient.messages.create({ body: text, to, messagingServiceSid });
      console.info('[sendSms] Sent via Messaging Service');
    } else {
      console.warn('[sendSms] Skipping send: neither from nor TWILIO_MESSAGING_SERVICE_SID provided', { to });
    }
  } catch (err) {
    console.error('[sendSms] Twilio send failed', { err });
    throw err;
  }
}

