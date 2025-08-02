import "server-only";
import twilio from "twilio";

const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken } =
  process.env;

if (!accountSid || !authToken) {
  console.warn("Twilio credentials not set. Twilio client will be disabled.");
}

export const twilioClient =
  accountSid && authToken ? twilio(accountSid, authToken, {
    region: 'au1',  // AU1 region support for Australian accounts
    edge: 'sydney'   // Use Sydney edge for better performance
  }) : null;
export default twilioClient;
