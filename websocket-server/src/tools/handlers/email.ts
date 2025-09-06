import { FunctionHandler } from '../../agentConfigs/types';
import { sendEmail } from '../../email';
import { getReplyTo } from '../../emailState';

export const sendEmailTool: FunctionHandler = {
  schema: {
    name: 'send_email',
    type: 'function',
    description: 'Send an email to an email recipient. If the current conversation channel is email, the recipient will be the email address of the sender of the current email. If the current conversation channel is not email, the recipient will be the default recipient specified in the environment variables.',
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
    const currentReplyTo = getReplyTo();
    const defaultRecipient = process.env.EMAIL_DEFAULT_TO || '';
    const recipient = currentReplyTo || defaultRecipient;

    if (!recipient) {
      const errorMessage = 'No recipient address is available. Set EMAIL_DEFAULT_TO in environment variables or receive an email first to establish a reply-to address.';
      console.warn(`[sendEmailTool] ${errorMessage}`);
      return { status: 'failed', reason: errorMessage };
    }

    if (!currentReplyTo && defaultRecipient) {
      console.info('[sendEmailTool] No current email channel open; falling back to default user email address.');
    }

    try {
      await sendEmail(subject, message, recipient);
      return { status: 'sent' };
    } catch (e: any) {
      return { status: 'failed', error: e?.message || String(e) };
    }
  }
};
