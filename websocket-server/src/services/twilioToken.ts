import type { Request, Response } from 'express';

export interface TwilioAccessTokenResult {
  token: string;
  identity: string;
}

export class TwilioConfigError extends Error {}

/**
 * Create a Twilio Voice access token (AU1 region) for the given identity.
 * Reads required secrets from environment variables.
 */
export function createTwilioAccessToken(identity: string): TwilioAccessTokenResult {
  // Lazily require twilio to avoid import cost if unused
  const twilio = require('twilio');
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new TwilioConfigError('Missing required Twilio credentials in environment variables');
  }

  const voiceGrant = new VoiceGrant({
    incomingAllow: true,
    outgoingApplicationSid: twimlAppSid,
  });

  const token = new AccessToken(
    accountSid,
    apiKeySid,
    apiKeySecret,
    {
      identity,
      region: 'au1',
    }
  );

  token.addGrant(voiceGrant);

  const jwt = token.toJwt();
  return { token: jwt, identity };
}
