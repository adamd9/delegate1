import { FunctionHandler } from '../../agentConfigs/types';
import { sendSms } from '../../sms';
import { getNumbers, ensureNumbersFromEnv } from '../../smsState';

export const sendSmsTool: FunctionHandler = {
  schema: {
    name: 'send_sms',
    type: 'function',
    description: 'Send a text message to the user\'s phone number. The user\'s phone number is known to the tool, so it doesn\'t need to be specified as part of the tool call and the user doesn\'t need to provide it.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The SMS message to send.' }
      },
      required: ['message'],
      additionalProperties: false
    }
  },
  handler: async ({ message }: { message: string }) => {
    console.debug('[sendSmsTool] Invoked', { hasBody: Boolean(message?.length) });
    ensureNumbersFromEnv();
    const { smsUserNumber, smsTwilioNumber } = getNumbers();
    console.debug('[sendSmsTool] Numbers after ensure', { smsUserNumber, smsTwilioNumber });
    if (!smsUserNumber || !smsTwilioNumber) {
      console.warn('[sendSmsTool] Missing phone numbers for SMS. Ensure env defaults are set (TWILIO_SMS_DEFAULT_TO, TWILIO_SMS_FROM) or numbers captured via webhook', { smsUserNumber, smsTwilioNumber });
      return { status: 'failed', reason: 'missing numbers' };
    }
    try {
      await sendSms(message, smsTwilioNumber, smsUserNumber);
      return { status: 'sent' };
    } catch (e: any) {
      // Never throw from the tool; surface a structured error so the model can reply gracefully
      return { status: 'failed', error: e?.message || String(e) };
    }
  }
};
