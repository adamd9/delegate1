/**
 * Summarize verbose keys (instructions, tools) in API request bodies for logging.
 * The actual request sent to the API is unchanged — this only affects console output.
 */
export function summarizeRequestForLog(body: Record<string, any>): Record<string, any> {
  const copy = { ...body };
  if (typeof copy.instructions === 'string' && copy.instructions.length > 200) {
    copy.instructions = `[system prompt, ${copy.instructions.length} chars]`;
  }
  if (Array.isArray(copy.tools)) {
    const names = copy.tools
      .map((t: any) => t.name || t.function?.name)
      .filter(Boolean);
    copy.tools = `[${names.length} tools: ${names.join(', ')}]`;
  }
  return copy;
}
