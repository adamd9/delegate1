// Centralized, minimal SMS state (single-user assumption)
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_WINDOW_MS = 30_000;

let replyWindowMs = DEFAULT_WINDOW_MS;
let smsReplyUntil = 0;

// Allow fallbacks via env vars (support a few aliases) and trim values
function readEnvNumber(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

const DEFAULT_SMS_TO = readEnvNumber('TWILIO_SMS_DEFAULT_TO', 'SMS_DEFAULT_TO');
const DEFAULT_SMS_FROM = readEnvNumber('TWILIO_SMS_FROM', 'TWILIO_SMS_DEFAULT_FROM', 'SMS_FROM');

let smsUserNumber = DEFAULT_SMS_TO;     // Destination (user) number
let smsTwilioNumber = DEFAULT_SMS_FROM; // Our Twilio sender number

// Init diagnostics (safe): indicate presence and masked values
try {
  const mask = (v: string) => (v ? `${v.slice(0, 3)}***${v.slice(-2)}` : '');
  console.debug('[smsState] Defaults', {
    hasDefaultTo: Boolean(DEFAULT_SMS_TO),
    hasDefaultFrom: Boolean(DEFAULT_SMS_FROM),
    defaultToMasked: mask(DEFAULT_SMS_TO),
    defaultFromMasked: mask(DEFAULT_SMS_FROM),
  });
} catch {}

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
  const before = { smsUserNumber, smsTwilioNumber };
  if (!smsUserNumber && DEFAULT_SMS_TO) smsUserNumber = DEFAULT_SMS_TO;
  if (!smsTwilioNumber && DEFAULT_SMS_FROM) smsTwilioNumber = DEFAULT_SMS_FROM;
  const after = { smsUserNumber, smsTwilioNumber };
  if ((before.smsUserNumber !== after.smsUserNumber) || (before.smsTwilioNumber !== after.smsTwilioNumber)) {
    console.debug('[smsState] ensureNumbersFromEnv applied defaults', after);
  } else {
    console.debug('[smsState] ensureNumbersFromEnv no-op (no defaults present or already set)');
  }
}
