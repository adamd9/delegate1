// Centralized, minimal SMS state (single-user assumption)
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_WINDOW_MS = 30_000;

let replyWindowMs = DEFAULT_WINDOW_MS;
let smsReplyUntil = 0;

// Allow fallbacks via env vars
const DEFAULT_SMS_TO = process.env.TWILIO_SMS_DEFAULT_TO || '';
const DEFAULT_SMS_FROM = process.env.TWILIO_SMS_FROM || '';

let smsUserNumber = DEFAULT_SMS_TO;     // Destination (user) number
let smsTwilioNumber = DEFAULT_SMS_FROM; // Our Twilio sender number

export function setWindowMs(ms: number) {
  replyWindowMs = ms;
}

export function openReplyWindow(nowMs = Date.now()) {
  smsReplyUntil = nowMs + replyWindowMs;
}

export function isSmsWindowOpen(nowMs = Date.now()) {
  return nowMs < smsReplyUntil;
}

export function setNumbers({ userFrom, twilioTo }: { userFrom: string; twilioTo: string }) {
  if (userFrom) {
    smsUserNumber = userFrom;
  }
  if (twilioTo) {
    smsTwilioNumber = twilioTo;
  }
}

export function getNumbers() {
  return { smsUserNumber, smsTwilioNumber };
}
