import twilio from 'twilio';
import dotenv from 'dotenv';
import { configService } from './config';
dotenv.config();

export async function sendSms(text: string, from: string, to: string) {
  const accountSid = configService.get('TWILIO_SMS_ACCOUNT_SID') || configService.get('TWILIO_ACCOUNT_SID');
  const authToken = configService.get('TWILIO_SMS_AUTH_TOKEN') || configService.get('TWILIO_AUTH_TOKEN');
  if (!accountSid || !authToken) {
    console.warn('[sendSms] Skipping send: Twilio credentials missing');
    return;
  }
  if (!text?.trim() || !to) {
    console.warn('[sendSms] Skipping send: missing text or to', { text, from, to });
    return;
  }
  if (!from) {
    console.warn('[sendSms] Skipping send: no from number provided', { to });
    return;
  }
  const twilioClient = twilio(accountSid, authToken);
  try {
    await twilioClient.messages.create({ body: text, from, to });
  } catch (err) {
    console.error('[sendSms] Twilio send failed', { err });
    throw err;
  }
}

