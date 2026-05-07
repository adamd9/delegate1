import twilio from 'twilio';
import { FunctionHandler } from '../../agentConfigs/types';
import { getNumbers, ensureNumbersFromEnv } from '../../smsState';

/**
 * Escape XML special characters for TwiML content.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const callUserTool: FunctionHandler = {
  schema: {
    name: 'call_user',
    type: 'function',
    description: 'Call the user\'s phone number and deliver a spoken message. The phone number is known to the tool and does not need to be provided. Use this when the user asks to be called, or when a phone call is more appropriate than a text message (e.g. urgent reminders, wake-up calls).',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to speak to the user when they answer the call.'
        }
      },
      required: ['message'],
      additionalProperties: false
    }
  },
  handler: async ({ message }: { message: string }) => {
    console.log('[callUserTool] Invoked', { messageLen: message?.length });

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.warn('[callUserTool] Missing Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)');
      return { status: 'failed', reason: 'missing Twilio credentials' };
    }

    ensureNumbersFromEnv();
    const { smsUserNumber, smsTwilioNumber } = getNumbers();

    if (!smsUserNumber || !smsTwilioNumber) {
      console.warn('[callUserTool] Missing phone numbers', { smsUserNumber, smsTwilioNumber });
      return { status: 'failed', reason: 'missing phone numbers' };
    }

    try {
      const client = twilio(accountSid, authToken);

      const twiml = `<Response><Say voice="alice" language="en-US">${escapeXml(message)}</Say></Response>`;

      const call = await client.calls.create({
        twiml,
        to: smsUserNumber,
        from: smsTwilioNumber,
        timeout: 30,
      });

      console.log('[callUserTool] Call initiated', { callSid: call.sid, status: call.status });
      return { status: 'calling', callSid: call.sid };
    } catch (e: any) {
      console.error('[callUserTool] Failed', { error: e?.message || String(e) });
      return { status: 'failed', error: e?.message || String(e) };
    }
  }
};
