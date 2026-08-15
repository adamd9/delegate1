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
  const statusToolInstruction = options.taskId
    ? `Use the \`copilot_task_status\` tool with \`task_id_or_name\` set to \`${options.taskId}\` to retrieve this task's full output.`
    : 'Use the `copilot_status` tool to retrieve the full output.';

  return (
    `[COPILOT TASK NOTIFICATION - this is NOT from the user]\n\n` +
    `A background task you dispatched has ${statusLine}.\n` +
    `Task: "${options.title}"${taskIdLine}${conversationLine}${linkLine}${gitLine}\n\n` +
    `Delivery preference: ${preference}.\n\n` +
    `${statusToolInstruction} Then deliver the result via the recorded preference (default SMS), include the task link, and complete any originally requested follow-up action. Do not merely acknowledge completion.`
  );
}