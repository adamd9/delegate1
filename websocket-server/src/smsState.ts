// Centralized, minimal SMS state (single-user assumption)

const DEFAULT_WINDOW_MS = 30_000;

let replyWindowMs = DEFAULT_WINDOW_MS;
let smsReplyUntil = 0;

// Allow a fallback recipient number via env var
const DEFAULT_SMS_TO = process.env.TWILIO_SMS_DEFAULT_TO || '';

let smsUserNumber = DEFAULT_SMS_TO;   // req.body.From or env default
let smsTwilioNumber = ''; // req.body.To

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
