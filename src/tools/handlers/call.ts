import twilio from 'twilio';
import { FunctionHandler } from '../../agentConfigs/types';
import { getNumbers, ensureNumbersFromEnv } from '../../smsState';

export const callUserTool: FunctionHandler = {
  schema: {
    name: 'call_user',
    type: 'function',
    description: 'Call the user\'s phone number and start a live voice conversation (OpenAI Realtime). The phone number is known to the tool and does not need to be provided. Use this when the user asks to be called, or when a real-time voice conversation is more appropriate than text.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief reason for the call (used for logging, not spoken to user).'
        }
      },
      required: ['reason'],
      additionalProperties: false
    }
  },
  handler: async ({ reason }: { reason: string }) => {
    console.log('[callUserTool] Invoked', { reason });

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const publicUrl = process.env.PUBLIC_URL;

    if (!accountSid || !authToken) {
      console.warn('[callUserTool] Missing Twilio credentials');
      return { status: 'failed', reason: 'missing Twilio credentials' };
    }

    if (!publicUrl) {
      console.warn('[callUserTool] Missing PUBLIC_URL for TwiML webhook');
      return { status: 'failed', reason: 'missing PUBLIC_URL' };
    }

    ensureNumbersFromEnv();
    const { smsUserNumber, smsTwilioNumber } = getNumbers();

    if (!smsUserNumber || !smsTwilioNumber) {
      console.warn('[callUserTool] Missing phone numbers', { smsUserNumber, smsTwilioNumber });
      return { status: 'failed', reason: 'missing phone numbers' };
    }

    try {
      const client = twilio(accountSid, authToken);

      // Use the same /twiml endpoint that inbound calls use —
      // it returns TwiML that opens a WebSocket stream to /call,
      // which connects to OpenAI Realtime for live voice conversation.
      const twimlUrl = `${publicUrl}/twiml`;

      const call = await client.calls.create({
        url: twimlUrl,
        to: smsUserNumber,
        from: smsTwilioNumber,
        timeout: 30,
      });

      console.log('[callUserTool] Call initiated', { callSid: call.sid, to: smsUserNumber, twimlUrl });
      return { status: 'calling', callSid: call.sid };
    } catch (e: any) {
      console.error('[callUserTool] Failed', { error: e?.message || String(e) });
      return { status: 'failed', error: e?.message || String(e) };
    }
  }
};
