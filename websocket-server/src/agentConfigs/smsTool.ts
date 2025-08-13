import { FunctionHandler } from './types';
import { sendSms } from '../sms';
import { getNumbers } from '../smsState';

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
    const { smsUserNumber, smsTwilioNumber } = getNumbers();
    if (!smsUserNumber || !smsTwilioNumber) {
      console.warn('[sendSmsTool] Missing phone numbers for SMS', { smsUserNumber, smsTwilioNumber });
      return { status: 'failed', reason: 'missing numbers' };
    }
    await sendSms(body, smsTwilioNumber, smsUserNumber);
    return { status: 'sent' };
  }
};
