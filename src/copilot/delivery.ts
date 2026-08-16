import { randomUUID } from 'crypto';
import { configService } from '../config';
import { addConversationEvent } from '../db/sqlite';
import { sendEmail } from '../email';
import { getEffectivePublicUrl } from '../server/config/env';
import { isOpen, jsonSend } from '../session/state';
import { sendSms } from '../sms';
import { ensureNumbersFromEnv, getNumbers } from '../smsState';
import { chatClients } from '../ws/clients';
import { addEvent, getTask, listTasks, updateTask, type CopilotTaskRow } from './tasks';

type DeliveryChannel = 'chat' | 'sms' | 'email';

export type DeliveryDestination = {
  channel: DeliveryChannel;
  target?: string;
};

type DeliveryState = {
  completionKey: string;
  status: 'pending' | 'delivering' | 'delivered' | 'failed';
  channel?: DeliveryChannel;
  target?: string;
  attempts: number;
  lastAttemptAtMs?: number;
  nextAttemptAtMs?: number;
  deliveredAtMs?: number;
  lastError?: string;
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 30_000];
const timers = new Map<string, NodeJS.Timeout>();
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'awaiting_user']);

function parseMeta(task: CopilotTaskRow): Record<string, any> {
  try { return task.meta_json ? JSON.parse(task.meta_json) : {}; } catch { return {}; }
}

export function resolveDeliveryDestination(preference?: string | null): DeliveryDestination {
  const value = String(preference || 'sms').trim();
  const normalized = value.toLowerCase();
  if (!value || normalized === 'sms') return { channel: 'sms' };
  if (normalized === 'email') return { channel: 'email' };
  if (normalized === 'chat') return { channel: 'chat' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { channel: 'email', target: value };
  if (/^\+[1-9]\d{7,14}$/.test(value)) return { channel: 'sms', target: value };
  throw new Error(`Unsupported delivery preference: ${value}`);
}

export function formatTaskDeliveryMessage(task: Pick<CopilotTaskRow, 'id' | 'title' | 'status' | 'last_summary'>): string {
  const base = getEffectivePublicUrl().replace(/\/$/, '');
  const status = task.status === 'completed'
    ? 'completed'
    : task.status === 'awaiting_user'
      ? 'needs your input'
      : 'failed';
  const summary = String(task.last_summary || '').trim() || 'No summary was returned.';
  return `Copilot task "${task.title}" ${status}.\n\n${summary}\n\n${base}/tasks/${task.id}`;
}

export function taskDeliveryCompletionKey(
  task: Pick<CopilotTaskRow, 'turn_count' | 'status' | 'ended_at_ms'>,
): string {
  return `${task.turn_count}:${task.status}:${task.ended_at_ms || 0}`;
}

async function deliverToChat(task: CopilotTaskRow, message: string): Promise<void> {
  const conversationId = task.originating_conversation_id;
  if (!conversationId) throw new Error('The task has no originating conversation for chat delivery.');
  const timestamp = Date.now();
  const spanId = `span_copilot_${task.id}_${randomUUID().slice(0, 8)}`;
  const itemId = `copilot_delivery_${task.id}_${timestamp}`;
  addConversationEvent({
    conversation_id: conversationId,
    kind: 'activity_span_started',
    payload: { span_id: spanId, kind: 'inner', channel: 'text', task_id: task.id },
    created_at_ms: timestamp,
  });
  addConversationEvent({
    conversation_id: conversationId,
    kind: 'message_assistant',
    payload: { text: message, channel: 'text', supervisor: false, span_id: spanId, task_id: task.id },
    created_at_ms: timestamp + 1,
  });
  addConversationEvent({
    conversation_id: conversationId,
    kind: 'activity_span_closed',
    payload: { span_id: spanId, reason: 'copilot_task_delivered', channel: 'text', task_id: task.id },
    created_at_ms: timestamp + 2,
  });
  for (const ws of chatClients) {
    if (!isOpen(ws)) continue;
    jsonSend(ws, {
      type: 'timeline.span.started', span_id: spanId, conversation_id: conversationId,
      kind: 'inner', channel: 'text', timestamp,
    });
    jsonSend(ws, {
      type: 'conversation.item.created', span_id: spanId, conversation_id: conversationId,
      timestamp: timestamp + 1,
      item: {
        id: itemId, type: 'message', role: 'assistant', channel: 'text', supervisor: false,
        content: [{ type: 'text', text: message }],
      },
    });
    jsonSend(ws, {
      type: 'timeline.span.closed', span_id: spanId, conversation_id: conversationId,
      reason: 'copilot_task_delivered', channel: 'text', timestamp: timestamp + 2,
    });
  }
}

async function deliver(task: CopilotTaskRow, destination: DeliveryDestination, message: string): Promise<void> {
  if (destination.channel === 'chat') {
    await deliverToChat(task, message);
    return;
  }
  if (destination.channel === 'sms') {
    ensureNumbersFromEnv();
    const { smsUserNumber, smsTwilioNumber } = getNumbers();
    const target = destination.target || smsUserNumber;
    if (!target || !smsTwilioNumber) throw new Error('SMS destination or sender number is not configured.');
    if (!(configService.get('TWILIO_SMS_ACCOUNT_SID') || configService.get('TWILIO_ACCOUNT_SID'))
      || !(configService.get('TWILIO_SMS_AUTH_TOKEN') || configService.get('TWILIO_AUTH_TOKEN'))) {
      throw new Error('Twilio SMS credentials are not configured.');
    }
    await sendSms(message, smsTwilioNumber, target);
    return;
  }
  const target = destination.target || configService.get('EMAIL_DEFAULT_TO') || '';
  if (!target) throw new Error('Email destination is not configured.');
  if (!configService.get('EMAIL_SMTP_HOST') || !configService.get('EMAIL_SMTP_PORT')
    || !configService.get('EMAIL_SMTP_USER') || !configService.get('EMAIL_SMTP_PASS')) {
    throw new Error('SMTP credentials are not configured.');
  }
  await sendEmail(`Copilot task: ${task.title}`, message, target);
}

function saveDelivery(task: CopilotTaskRow, delivery: DeliveryState): void {
  const latest = getTask(task.id) || task;
  updateTask(task.id, { meta: { ...parseMeta(latest), delivery } });
}

async function attemptTaskDelivery(taskId: string): Promise<void> {
  timers.delete(taskId);
  const task = getTask(taskId);
  if (!task || !TERMINAL_STATUSES.has(task.status)) return;
  const completionKey = taskDeliveryCompletionKey(task);
  const meta = parseMeta(task);
  const current = meta.delivery as DeliveryState | undefined;
  const currentForCompletion = current?.completionKey === completionKey ? current : undefined;
  if (currentForCompletion?.status === 'delivered' || (currentForCompletion?.attempts || 0) >= MAX_ATTEMPTS) return;

  let destination: DeliveryDestination;
  try {
    destination = resolveDeliveryDestination(meta.notify);
  } catch (error: any) {
    saveDelivery(task, {
      completionKey, status: 'failed', attempts: MAX_ATTEMPTS,
      lastAttemptAtMs: Date.now(), lastError: error?.message || String(error),
    });
    return;
  }

  const attempts = (currentForCompletion?.attempts || 0) + 1;
  saveDelivery(task, {
    completionKey, status: 'delivering', channel: destination.channel, target: destination.target,
    attempts, lastAttemptAtMs: Date.now(),
  });
  try {
    await deliver(task, destination, formatTaskDeliveryMessage(task));
    const refreshed = getTask(taskId);
    if (refreshed) saveDelivery(refreshed, {
      completionKey, status: 'delivered', channel: destination.channel, target: destination.target,
      attempts, lastAttemptAtMs: Date.now(), deliveredAtMs: Date.now(),
    });
    addEvent({ task_id: taskId, kind: 'system', payload: { delivery: 'delivered', channel: destination.channel, attempts } });
  } catch (error: any) {
    const message = error?.message || String(error);
    const nextDelay = attempts < MAX_ATTEMPTS ? RETRY_DELAYS_MS[attempts - 1] : undefined;
    const refreshed = getTask(taskId);
    if (refreshed) saveDelivery(refreshed, {
      completionKey, status: 'failed', channel: destination.channel, target: destination.target,
      attempts, lastAttemptAtMs: Date.now(),
      ...(nextDelay ? { nextAttemptAtMs: Date.now() + nextDelay } : {}),
      lastError: message,
    });
    addEvent({ task_id: taskId, kind: 'system', payload: { delivery: 'failed', channel: destination.channel, attempts, error: message } });
    if (nextDelay) scheduleTaskDelivery(taskId, nextDelay);
  }
}

export function scheduleTaskDelivery(taskId: string, delayMs = 0): void {
  if (timers.has(taskId)) return;
  const timer = setTimeout(() => {
    void attemptTaskDelivery(taskId);
  }, Math.max(0, delayMs));
  timer.unref?.();
  timers.set(taskId, timer);
}

export function queueTaskDelivery(taskId: string): void {
  const task = getTask(taskId);
  if (!task) return;
  const meta = parseMeta(task);
  const delivery = meta.delivery as DeliveryState | undefined;
  const completionKey = taskDeliveryCompletionKey(task);
  if (delivery?.completionKey === completionKey && delivery.status === 'delivered') return;
  if (delivery?.completionKey !== completionKey) {
    saveDelivery(task, { completionKey, status: 'pending', attempts: 0 });
  }
  scheduleTaskDelivery(taskId);
}

export function resumeTaskDeliveries(): void {
  const tasks = listTasks({ includeArchived: false, statuses: ['completed', 'failed', 'awaiting_user'] });
  for (const task of tasks) {
    const delivery = parseMeta(task).delivery as DeliveryState | undefined;
    const completionKey = taskDeliveryCompletionKey(task);
    if (!delivery || delivery.completionKey !== completionKey
      || delivery.status === 'delivered' || delivery.attempts >= MAX_ATTEMPTS) continue;
    scheduleTaskDelivery(task.id, Math.max(0, (delivery.nextAttemptAtMs || 0) - Date.now()));
  }
}