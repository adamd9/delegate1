import type { Application, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setNumbers } from '../../smsState';
import { createTwilioAccessToken, TwilioConfigError } from '../../services/twilioToken';
import { processSmsWebhook } from '../../session/sms';

export function registerTwilioRoutes(app: Application, opts: { effectivePublicUrl: string; chatClients: Set<any>; logsClients: Set<any>; }) {
  const { effectivePublicUrl, chatClients, logsClients } = opts;

  // Simple public URL helper
  app.get('/public-url', (req: Request, res: Response) => {
    res.json({ publicUrl: effectivePublicUrl });
  });

  // TwiML endpoint
  const twimlPath = join(__dirname, '../../twiml.xml');
  const twimlTemplate = readFileSync(twimlPath, 'utf-8');

  app.all('/twiml', (req: Request, res: Response) => {
    const wsUrl = new URL(effectivePublicUrl);
    wsUrl.protocol = 'wss:';
    wsUrl.pathname = `/call`;

    const from = (req.query?.From as string) || '';
    const to = (req.query?.To as string) || '';
    const defaultTo = process.env.TWILIO_SMS_DEFAULT_TO || '';
    try {
      setNumbers({ userFrom: defaultTo || from, twilioTo: to });
    } catch (e) {
      console.warn('⚠️ Failed to set call numbers', e);
    }

    const twimlContent = twimlTemplate.replace('{{WS_URL}}', wsUrl.toString());
    console.debug('TWIML:', twimlContent);
    res.type('text/xml').send(twimlContent);
  });

  // Access token endpoint for voice client
  app.post('/access-token', (req: Request, res: Response) => {
    try {
      const clientName = (req.body as any)?.clientName || `voice-client-${Date.now()}`;
      const { token, identity } = createTwilioAccessToken(clientName);
      console.log(`Generated access token for client: ${clientName}`);
      res.json({ token, identity, message: 'Access token generated successfully' });
    } catch (error: any) {
      if (error instanceof TwilioConfigError) {
        console.error('Missing required Twilio environment variables');
        res.status(500).json({
          error: 'Server configuration error',
          message: error.message,
        });
        return;
      }
      console.error('Error generating access token:', error);
      res.status(500).json({
        error: 'Failed to generate access token',
        message: error?.message || 'Unknown error',
      });
    }
  });

  // Twilio SMS webhook -> normalize into chat flow
  app.post('/sms', async (req: Request, res: Response) => {
    const messageText = (req.body as any)?.Body ?? '';
    const from = (req.body as any)?.From ?? '';
    const to = (req.body as any)?.To ?? '';

    await processSmsWebhook({ messageText, from, to }, chatClients as any, logsClients as any);
    res.status(200).end();
  });
}
