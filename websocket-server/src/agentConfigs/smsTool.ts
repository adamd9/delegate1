import { FunctionHandler } from './types';
import { sendSms } from '../sms';
import { getNumbers, ensureNumbersFromEnv } from '../smsState';

export const sendSmsTool: FunctionHandler = {
  schema: {
    name: 'send_sms',
    type: 'function',
    description: 'Send a text message to the user\'s phone number.',
    parameters: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'The SMS message to send.' }
      },
      required: ['body'],
      additionalProperties: false
    }
  },
  handler: async ({ body }: { body: string }) => {
    console.debug('[sendSmsTool] Invoked', { hasBody: Boolean(body?.length) });
    ensureNumbersFromEnv();
    const { smsUserNumber, smsTwilioNumber } = getNumbers();
    console.debug('[sendSmsTool] Numbers after ensure', { smsUserNumber, smsTwilioNumber });
    if (!smsUserNumber || !smsTwilioNumber) {
      console.warn('[sendSmsTool] Missing phone numbers for SMS. Ensure env defaults are set (TWILIO_SMS_DEFAULT_TO, TWILIO_SMS_FROM) or numbers captured via webhook', { smsUserNumber, smsTwilioNumber });
      return { status: 'failed', reason: 'missing numbers' };
    }
    await sendSms(body, smsTwilioNumber, smsUserNumber);
    return { status: 'sent' };
  }
};
