import twilio from 'twilio';
import { FunctionHandler } from '../../agentConfigs/types';
import { getNumbers, ensureNumbersFromEnv } from '../../smsState';
import { session } from '../../session/state';

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

    // Use the same credentials as the rest of the Twilio voice integration.
    // Fall back through credential options: API key pair > Auth Token
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    const publicUrl = process.env.PUBLIC_URL;

    if (!accountSid) {
      console.warn('[callUserTool] Missing TWILIO_ACCOUNT_SID');
      return { status: 'failed', reason: 'missing TWILIO_ACCOUNT_SID' };
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
      // Snapshot recent conversation so the outbound call has continuity
      const history = session.conversationHistory || [];
      const recentTurns = history
        .filter((t): t is Extract<typeof t, { type: 'user' | 'assistant' }> =>
          t.type === 'user' || t.type === 'assistant')
        .slice(-10)
        .map(t => ({
          role: t.type === 'user' ? 'user' : 'assistant',
          content: t.content,
        }));
      session.outboundCallContext = {
        conversationId: (session as any).currentConversationId || undefined,
        recentTurns,
      };

      // Prefer API key auth (more common in production), fall back to auth token
      let client: ReturnType<typeof twilio>;
      if (apiKeySid && apiKeySecret) {
        console.log('[callUserTool] Using API key auth');
        client = twilio(apiKeySid, apiKeySecret, { accountSid, region: 'au1', edge: 'sydney' });
      } else if (authToken) {
        console.log('[callUserTool] Using auth token');
        client = twilio(accountSid, authToken, { region: 'au1', edge: 'sydney' });
      } else {
        console.warn('[callUserTool] No auth credentials available');
        return { status: 'failed', reason: 'missing Twilio auth credentials' };
      }

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
