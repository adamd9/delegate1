import twilio from 'twilio';
import dotenv from 'dotenv';
import { configService } from './config';
dotenv.config();

export async function sendSms(text: string, from: string, to: string) {
  const accountSid = configService.get('TWILIO_SMS_ACCOUNT_SID');
  const authToken = configService.get('TWILIO_SMS_AUTH_TOKEN');
  const messagingServiceSid = configService.get('TWILIO_MESSAGING_SERVICE_SID');
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
      await twilioClient.messages.create({ body: text, from, to });
    } else if (messagingServiceSid) {
      await twilioClient.messages.create({ body: text, to, messagingServiceSid });
    } else {
      console.warn('[sendSms] Skipping send: neither from nor TWILIO_MESSAGING_SERVICE_SID provided', { to });
    }
  } catch (err) {
    console.error('[sendSms] Twilio send failed', { err });
    throw err;
  }
}

