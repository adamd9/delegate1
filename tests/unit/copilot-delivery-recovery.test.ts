import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TaskStatus } from '../../src/copilot/tasks';

async function main() {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'delegate-delivery-recovery-'));
  process.env.RUNTIME_DATA_DIR = runtimeDir;

  const scheduled: Array<{ delay: number; unref(): void }> = [];
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  global.setTimeout = ((_: () => void, delay = 0) => {
    const timer = { delay, unref() {} };
    scheduled.push(timer);
    return timer;
  }) as any;
  global.clearTimeout = (() => {}) as any;

  const sqlite = await import('../../src/db/sqlite');
  const tasks = await import('../../src/copilot/tasks');
  const delivery = await import('../../src/copilot/delivery');

  const createTask = (id: string, status: TaskStatus, deliveryState?: Record<string, unknown>) => {
    tasks.insertTask({
      id, title: id, status, workdir: runtimeDir,
      meta: deliveryState ? { notify: 'chat', delivery: deliveryState } : { notify: 'chat' },
    });
    tasks.incrementTurnCount(id);
    tasks.updateTask(id, { status, ended_at_ms: 100 });
    return tasks.getTask(id)!;
  };

  const exhausted = createTask('retry-task', 'completed');
  const completionKey = delivery.taskDeliveryCompletionKey(exhausted);
  tasks.updateTask(exhausted.id, { meta: {
    notify: 'chat',
    delivery: { completionKey, status: 'failed', channel: 'chat', attempts: 3, lastError: 'offline' },
  } });
  const retried = delivery.retryTaskDelivery(exhausted.id);
  assert.deepStrictEqual(retried, {
    completionKey, status: 'pending', channel: 'chat', target: undefined, attempts: 0,
  });
  assert.strictEqual(scheduled.length, 1);
  assert.strictEqual(scheduled[0].delay, 0);
  const savedRetry = JSON.parse(tasks.getTask(exhausted.id)!.meta_json || '{}').delivery;
  assert.strictEqual(savedRetry.status, 'pending');
  assert.strictEqual(savedRetry.attempts, 0);

  const delivered = createTask('delivered-task', 'completed');
  const deliveredKey = delivery.taskDeliveryCompletionKey(delivered);
  tasks.updateTask(delivered.id, { meta: {
    notify: 'chat', delivery: { completionKey: deliveredKey, status: 'delivered', attempts: 1 },
  } });
  assert.throws(() => delivery.retryTaskDelivery(delivered.id), /already delivered/);

  const delivering = createTask('delivering-task', 'completed');
  const deliveringKey = delivery.taskDeliveryCompletionKey(delivering);
  tasks.updateTask(delivering.id, { meta: {
    notify: 'chat', delivery: { completionKey: deliveringKey, status: 'delivering', attempts: 1 },
  } });
  assert.throws(() => delivery.retryTaskDelivery(delivering.id), /Only a failed delivery/);

  const running = createTask('running-task', 'running');
  tasks.updateTask(running.id, { meta: {
    notify: 'chat', delivery: { completionKey: 'running', status: 'failed', attempts: 1 },
  } });
  assert.throws(() => delivery.retryTaskDelivery(running.id), /after a task turn finishes/);

  const resumable = createTask('resume-task', 'failed');
  const resumableKey = delivery.taskDeliveryCompletionKey(resumable);
  tasks.updateTask(resumable.id, { meta: {
    notify: 'chat',
    delivery: {
      completionKey: resumableKey, status: 'failed', attempts: 1,
      nextAttemptAtMs: Date.now() - 1,
    },
  } });
  delivery.resumeTaskDeliveries();
  assert.strictEqual(scheduled.length, 3);
  assert.strictEqual(scheduled[1].delay, 0);
  assert.strictEqual(scheduled[2].delay, 0);

  sqlite.getDb().close();
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
  rmSync(runtimeDir, { recursive: true, force: true });
  console.log('copilot delivery recovery tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});