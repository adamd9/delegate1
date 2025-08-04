import twilio from 'twilio';

export async function sendSms(text: string, from: string, to: string) {
  const accountSid = process.env.TWILIO_SMS_ACCOUNT_SID;
  const authToken = process.env.TWILIO_SMS_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.warn('[sendSms] Skipping send: Twilio credentials missing');
    return;
  }
  if (!text?.trim() || !from || !to) {
    console.warn('[sendSms] Skipping send: missing text, from, or to', { text, from, to });
    return;
  }
  const twilioClient = twilio(accountSid, authToken);
  await twilioClient.messages.create({ body: text, from, to });
}

