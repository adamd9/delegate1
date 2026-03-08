import { getLogs } from '../../logBuffer';
import { listAllTools, getAgentsDebug } from '../../tools/registry';
import { createNote, listNotes, updateNote } from '../../noteStore';

/**
 * Writes or updates a single "Latest Startup Results" note summarizing tools, agents, and buffered logs.
 */
export async function writeLatestStartupResults(): Promise<void> {
  const title = 'Latest Startup Results';
  const logs = getLogs().join('\n');
  const tools = listAllTools();
  const agents = getAgentsDebug();
  const toolSummaryLines = tools.map(t => `- ${t.name} [${t.origin}]${t.tags && t.tags.length ? ` tags: ${t.tags.join(', ')}` : ''}`);
  const agentNames = Object.keys(agents || {});
  const content = [
    `Title: ${title}`,
    `Timestamp: ${new Date().toISOString()}`,
    '',
    '== Tool Catalog ==',
    `Count: ${tools.length}`,
    toolSummaryLines.join('\n'),
    '',
    '== Agents ==',
    `Agents: ${agentNames.join(', ')}`,
    '',
    '== Buffered Logs ==',
    logs || '(no logs captured)'
  ].join('\n');

  const existing = (await listNotes({ query: title }))
    .find(n => n.title.toLowerCase() === title.toLowerCase());
  if (existing) {
    await updateNote(existing.id, { title, content });
    console.log('[startup] Updated note with latest startup results');
  } else {
    await createNote(title, content);
    console.log('[startup] Created note with latest startup results');
  }
}
