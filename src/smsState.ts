// Centralized, minimal SMS state (single-user assumption)
import { configService } from './config';

const DEFAULT_WINDOW_MS = 180_000;

let replyWindowMs = DEFAULT_WINDOW_MS;
let smsReplyUntil = 0;

function readConfigValue(...keys: string[]): string {
  for (const key of keys) {
    const value = configService.get(key);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

const DEFAULT_SMS_TO = readConfigValue('TWILIO_SMS_DEFAULT_TO');
const DEFAULT_SMS_FROM = readConfigValue('TWILIO_PHONE_NUMBER');

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
  const u = (userFrom || '').trim();
  const t = (twilioTo || '').trim();
  if (u) {
    smsUserNumber = u;
  }
  if (t) {
    smsTwilioNumber = t;
  }
}

export function getNumbers() {
  return { smsUserNumber, smsTwilioNumber };
}

// If numbers are missing at call-time, try to refresh from env defaults
export function ensureNumbersFromEnv() {
  if (!smsUserNumber && DEFAULT_SMS_TO) smsUserNumber = DEFAULT_SMS_TO;
  if (!smsTwilioNumber && DEFAULT_SMS_FROM) smsTwilioNumber = DEFAULT_SMS_FROM;
}
