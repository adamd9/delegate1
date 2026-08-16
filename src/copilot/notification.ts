export function formatCopilotTaskNotification(options: {
  taskId?: string;
  title: string;
  status: string;
  conversationId?: string;
  taskUrl?: string;
  notifyPref?: string | null;
  gitMessage?: string;
}): string {
  const statusLine = options.status === 'complete' || options.status === 'completed'
    ? 'completed successfully'
    : options.status === 'error' || options.status === 'failed'
      ? 'encountered an error'
      : options.status === 'timeout'
        ? 'timed out'
        : `finished (${options.status})`;
  const conversationLine = options.conversationId ? `\nConversation ID: ${options.conversationId}` : '';
  const taskIdLine = options.taskId ? `\nTask ID: ${options.taskId}` : '';
  const linkLine = options.taskUrl ? `\nTask link: ${options.taskUrl}` : '';
  const gitLine = options.gitMessage ? `\nGit: ${options.gitMessage}` : '';
  const preference = options.notifyPref?.trim() || 'none recorded - default to SMS';
  const deliveryInstruction = options.taskId
    ? `Automatic delivery is handled from the persisted task ${options.taskId}; do not send a duplicate.`
    : 'No exact task ID was available, so automatic delivery could not be confirmed.';

  return (
    `[COPILOT TASK NOTIFICATION - this is NOT from the user]\n\n` +
    `A background task you dispatched has ${statusLine}.\n` +
    `Task: "${options.title}"${taskIdLine}${conversationLine}${linkLine}${gitLine}\n\n` +
    `Delivery preference: ${preference}.\n\n` +
    deliveryInstruction
  );
}