import assert from 'assert';
import { formatCopilotTaskNotification } from '../../src/copilot/notification';
import { githubRepositoryUrl, redactGitError } from '../../src/browser';
import {
  formatTaskDeliveryMessage,
  resolveDeliveryDestination,
  taskDeliveryCompletionKey,
} from '../../src/copilot/delivery';

const message = formatCopilotTaskNotification({
  taskId: 'abc-loan-investigation',
  title: 'Investigate home loan scenarios',
  status: 'completed',
  conversationId: 'conversation-1',
  taskUrl: 'https://example.test/tasks/abc-loan-investigation',
  notifyPref: 'email',
});

assert.match(message, /completed successfully/);
assert.match(message, /Task ID: abc-loan-investigation/);
assert.match(message, /Delivery preference: email/);
assert.match(message, /Automatic delivery is handled/);
assert.doesNotMatch(message, /Then deliver the result/);

assert.deepStrictEqual(resolveDeliveryDestination(null), { channel: 'sms' });
assert.deepStrictEqual(resolveDeliveryDestination('chat'), { channel: 'chat' });
assert.deepStrictEqual(resolveDeliveryDestination('person@example.test'), {
  channel: 'email', target: 'person@example.test',
});
assert.deepStrictEqual(resolveDeliveryDestination('+64210000000'), {
  channel: 'sms', target: '+64210000000',
});
assert.throws(() => resolveDeliveryDestination('send it somehow'), /Unsupported delivery preference/);
assert.match(formatTaskDeliveryMessage({
  id: 'abc-loan-investigation', title: 'Investigate home loan scenarios',
  status: 'completed', last_summary: 'The balanced option is scenario B.',
}), /The balanced option is scenario B/);
assert.notStrictEqual(
  taskDeliveryCompletionKey({ turn_count: 1, status: 'awaiting_user', ended_at_ms: 100 }),
  taskDeliveryCompletionKey({ turn_count: 2, status: 'completed', ended_at_ms: 200 }),
);
assert.strictEqual(githubRepositoryUrl('git@github.com:owner/project.git'), 'https://github.com/owner/project');
assert.strictEqual(
  githubRepositoryUrl('https://x-access-token:secret@github.com/owner/project.git'),
  'https://github.com/owner/project',
);
assert.strictEqual(githubRepositoryUrl('https://gitlab.com/owner/project.git'), undefined);
assert.doesNotMatch(
  redactGitError(
    new Error('git push "https://x-access-token:top-secret@github.com/owner/project.git" failed'),
    ['top-secret'],
  ),
  /top-secret/,
);

console.log('copilot notification tests passed');