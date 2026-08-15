import assert from 'assert';
import { formatCopilotTaskNotification } from '../../src/copilot/notification';

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
assert.match(message, /copilot_task_status/);
assert.match(message, /task_id_or_name/);
assert.match(message, /Delivery preference: email/);
assert.doesNotMatch(message, /Use the `copilot_status` tool/);

console.log('copilot notification tests passed');