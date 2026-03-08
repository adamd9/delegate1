import type { Application, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setNumbers } from '../../smsState';
import { createTwilioAccessToken, TwilioConfigError } from '../../services/twilioToken';
import { processSmsWebhook } from '../../session/sms';

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const twilio = require('twilio');
  return twilio(accountSid, authToken, { region: 'au1', edge: 'sydney' });
}

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

  // --- Frontend API helpers (migrated from Next.js /app/api) ---

  // Check whether Twilio credentials are configured
  app.get('/api/twilio', (_req: Request, res: Response) => {
    const credentialsSet = Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    );
    res.json({ credentialsSet, timestamp: new Date().toISOString() });
  });

  // List Twilio phone numbers
  app.get('/api/twilio/numbers', async (_req: Request, res: Response) => {
    const client = getTwilioClient();
    if (!client) {
      res.json([]);
      return;
    }
    try {
      const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
      res.json(numbers);
    } catch (err: any) {
      console.log('Phone number fetch failed (optional):', err?.message);
      res.json([]);
    }
  });

  // Update a Twilio phone number's voice URL
  app.post('/api/twilio/numbers', async (req: Request, res: Response) => {
    const client = getTwilioClient();
    if (!client) {
      res.status(500).json({ error: 'Twilio client not initialized' });
      return;
    }
    const { phoneNumberSid, voiceUrl } = req.body as { phoneNumberSid: string; voiceUrl: string };
    try {
      const updated = await client.incomingPhoneNumbers(phoneNumberSid).update({ voiceUrl });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to update phone number' });
    }
  });
}
