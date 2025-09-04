import { FunctionHandler } from '../../agentConfigs/types';
import { sendEmail } from '../../email';
import { getReplyTo } from '../../emailState';

export const sendEmailTool: FunctionHandler = {
  schema: {
    name: 'send_email',
    type: 'function',
    description: 'Send an email to the user. The user\'s email address is known to the tool, so it doesn\'t need to be specified as part of the tool call and the user doesn\'t need to provide it.',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'The subject of the email.' },
        message: { type: 'string', description: 'The body of the email.' }
      },
      required: ['subject', 'message'],
      additionalProperties: false
    }
  },
  handler: async ({ subject, message }: { subject: string; message: string }) => {
    console.debug('[sendEmailTool] Invoked', { hasSubject: Boolean(subject?.length), hasBody: Boolean(message?.length) });
    const recipient = getReplyTo();

    if (!recipient) {
      const errorMessage = 'No recipient address is available for the reply. An email must be received first.';
      console.warn(`[sendEmailTool] ${errorMessage}`);
      return { status: 'failed', reason: errorMessage };
    }

    try {
      await sendEmail(subject, message, recipient);
      return { status: 'sent' };
    } catch (e: any) {
      return { status: 'failed', error: e?.message || String(e) };
    }
  }
};
