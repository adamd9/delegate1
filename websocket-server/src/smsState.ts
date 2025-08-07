// Centralized, minimal SMS state (single-user assumption)

const DEFAULT_WINDOW_MS = 30_000;

let replyWindowMs = DEFAULT_WINDOW_MS;
let smsReplyUntil = 0;
let smsUserNumber = '';   // req.body.From
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
  smsUserNumber = userFrom || '';
  smsTwilioNumber = twilioTo || '';
}

export function getNumbers() {
  return { smsUserNumber, smsTwilioNumber };
}
