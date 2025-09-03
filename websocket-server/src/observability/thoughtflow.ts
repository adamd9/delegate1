import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { session } from '../session/state';

// Explicit step types for ThoughtFlow events
export enum ThoughtFlowStepType {
  UserMessage = 'user_message',
  AssistantMessage = 'assistant_message',
  AssistantCall = 'assistant_call',
  AssistantOutput = 'assistant_output',
  ToolCall = 'tool_call',
  ToolOutput = 'tool_output',
  ToolError = 'tool_error',
  Generic = 'generic',
}

// Store artifacts under websocket-server/runtime-data/thoughtflow (project root relative)
// At runtime __dirname is dist/observability, so go up two levels.
const BASE_DIR = join(__dirname, '..', '..', 'runtime-data', 'thoughtflow');

function ensureDir() {
  if (!existsSync(BASE_DIR)) {
    mkdirSync(BASE_DIR, { recursive: true });
  }
}

export function ensureSession(): { id: string; jsonlPath: string } {
  ensureDir();
  const tf = (session.thoughtflow ||= {} as any);
  if (!tf.sessionId) {
    tf.sessionId = `sess_${Date.now()}`;
    tf.startedAt = Date.now();
  }
  const jsonlPath = join(BASE_DIR, `${tf.sessionId}.jsonl`);
  tf.jsonlPath = jsonlPath;
  // Touch file with a header line only once
  if (!existsSync(jsonlPath)) {
    const header = JSON.stringify({ type: 'session.created', session_id: tf.sessionId, started_at: new Date(tf.startedAt!).toISOString() });
    appendFileSync(jsonlPath, header + '\n');
  }
  return { id: tf.sessionId, jsonlPath };
}

export function appendEvent(event: any) {
  try {
    const { jsonlPath } = ensureSession();
    appendFileSync(jsonlPath, JSON.stringify(event) + '\n');
  } catch (e) {
    console.warn('[thoughtflow] appendEvent failed:', (e as any)?.message || e);
  }
}

export function endSession(): { id: string; jsonPath: string; d2Path: string } | null {
  try {
    const { id, jsonlPath } = ensureSession();
    const jsonPath = join(BASE_DIR, `${id}.json`);
    // Read JSONL events and aggregate into runs/steps
    const raw = readFileSync(jsonlPath, 'utf8');
    const lines = raw.split(/\n+/).filter(Boolean);
    type Step = {
      step_id: string;
      label?: string;
      started_at?: string;
      ended_at?: string;
      duration_ms?: number;
      payload_started?: any;
      payload_completed?: any;
    };
    type Run = {
      run_id: string;
      channel?: string;
      status?: 'completed' | 'aborted' | 'error' | 'unknown';
      started_at?: string;
      ended_at?: string;
      duration_ms?: number;
      steps: Step[];
      _stepIndex: Record<string, Step>;
    };
    const runsMap = new Map<string, Run>();
    for (const line of lines) {
      let evt: any;
      try { evt = JSON.parse(line); } catch { continue; }
      const t = evt?.type as string | undefined;
      if (!t) continue;
      if (t === 'run.started') {
        const run_id = evt.run_id as string;
        if (!run_id) continue;
        const r = runsMap.get(run_id) || { run_id, steps: [], _stepIndex: {} } as Run;
        r.started_at = evt.started_at || new Date().toISOString();
        if (evt.channel) r.channel = evt.channel;
        runsMap.set(run_id, r);
        continue;
      }
      if (t === 'run.completed' || t === 'run.aborted') {
        const run_id = evt.run_id as string;
        if (!run_id) continue;
        const r = runsMap.get(run_id) || { run_id, steps: [], _stepIndex: {} } as Run;
        r.ended_at = evt.ended_at || new Date().toISOString();
        r.status = (evt.status as any) || (t === 'run.aborted' ? 'aborted' : 'completed');
        runsMap.set(run_id, r);
        continue;
      }
      if (t === 'step.started') {
        const run_id = evt.run_id as string;
        const step_id = evt.step_id as string;
        if (!run_id || !step_id) continue;
        const r = runsMap.get(run_id) || { run_id, steps: [], _stepIndex: {} } as Run;
        const s: Step = {
          step_id,
          label: evt.label,
          started_at: evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString(),
          payload_started: evt.payload,
        };
        if (evt.depends_on) (s as any).depends_on = evt.depends_on;
        r.steps.push(s);
        r._stepIndex[step_id] = s;
        runsMap.set(run_id, r);
        continue;
      }
      if (t === 'step.completed') {
        const run_id = evt.run_id as string;
        const step_id = evt.step_id as string;
        if (!run_id || !step_id) continue;
        const r = runsMap.get(run_id);
        if (!r) continue;
        const s = r._stepIndex[step_id];
        if (s) {
          s.ended_at = evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString();
          s.payload_completed = evt.payload;
        }
        continue;
      }
      if (t === 'run.canceled') {
        // Best-effort: mark the most recent run as aborted
        const last = [...runsMap.values()].pop();
        if (last) {
          last.status = 'aborted';
          last.ended_at = new Date().toISOString();
        }
      }
      if (t === 'session.ended') {
        // handled outside loop
      }
    }
    // Compute durations
    for (const r of runsMap.values()) {
      for (const s of r.steps) {
        if (s.started_at && s.ended_at) {
          s.duration_ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
        }
      }
      if (r.started_at && r.ended_at) {
        r.duration_ms = new Date(r.ended_at).getTime() - new Date(r.started_at).getTime();
      }
      // Default status
      if (!r.status) r.status = 'unknown';
    }
    const runs = Array.from(runsMap.values()).sort((a, b) => (a.started_at || '').localeCompare(b.started_at || ''))
      .map(r => ({
        run_id: r.run_id,
        channel: r.channel,
        status: r.status,
        started_at: r.started_at,
        ended_at: r.ended_at,
        duration_ms: r.duration_ms,
        steps: r.steps
          .sort((a, b) => (a.started_at || '').localeCompare(b.started_at || ''))
          .map(({ _stepIndex, ...s }: any) => s),
      }));

    const consolidated = {
      session_id: id,
      started_at: new Date((session.thoughtflow as any).startedAt!).toISOString(),
      ended_at: new Date().toISOString(),
      runs,
    } as const;
    writeFileSync(jsonPath, JSON.stringify(consolidated, null, 2));
    // Generate a simple D2 diagram for the session
    const d2 = generateD2(consolidated);
    const d2Path = join(BASE_DIR, `${id}.d2`);
    writeFileSync(d2Path, d2);
    appendFileSync(jsonlPath, JSON.stringify({ type: 'session.ended', session_id: id, ended_at: consolidated.ended_at }) + '\n');
    return { id, jsonPath, d2Path };
  } catch (e) {
    console.warn('[thoughtflow] endSession failed:', (e as any)?.message || e);
    return null;
  }
}

function sanitizeLabel(s?: string) {
  if (!s) return '';
  return String(s).replace(/"/g, '\\"');
}

function generateD2(consolidated: { session_id: string; runs: Array<{ run_id: string; status?: string; duration_ms?: number; steps: Array<{ step_id: string; label?: string; duration_ms?: number; started_at?: string; ended_at?: string; payload_started?: any; payload_completed?: any; }> }> }) {
  const lines: string[] = [];
  lines.push('# Auto-generated ThoughtFlow D2');
  lines.push(`// session: ${consolidated.session_id}`);
  lines.push('direction: down');
  lines.push('');
  // Classes per docs guide (multiline maps)
  lines.push('classes: {');
  lines.push('  runbox: {');
  lines.push('    style: {');
  lines.push('      fill: "#F7F9FC"');
  lines.push('      stroke: "#C9D2E3"');
  lines.push('      border-radius: 8');
  lines.push('    }');
  lines.push('  }');
  lines.push('  assistantout: {');
  lines.push('    style: {');
  lines.push('      fill: "#F5F8FF"');
  lines.push('      stroke: "#A8C5F7"');
  lines.push('      border-radius: 6');
  lines.push('    }');
  lines.push('  }');
  lines.push('  assistantcall: {');
  lines.push('    style: {');
  lines.push('      fill: "#EEF5FF"');
  lines.push('      stroke: "#7AA2E3"');
  lines.push('      border-radius: 6');
  lines.push('    }');
  lines.push('  }');
  lines.push('  user: {');
  lines.push('    style: {');
  lines.push('      fill: "#E8F1FF"');
  lines.push('      stroke: "#6FA8FF"');
  lines.push('      border-radius: 6');
  lines.push('    }');
  lines.push('  }');
  lines.push('  assistant: {');
  lines.push('    style: {');
  lines.push('      fill: "#E8FFF1"');
  lines.push('      stroke: "#66D19E"');
  lines.push('      border-radius: 6');
  lines.push('    }');
  lines.push('  }');
  lines.push('  tool: {');
  lines.push('    style: {');
  lines.push('      fill: "#FFF8E6"');
  lines.push('      stroke: "#F4B400"');
  lines.push('      border-radius: 6');
  lines.push('    }');
  lines.push('  }');
  lines.push('  toolout: {');
  lines.push('    style: {');
  lines.push('      fill: "#FFFDF2"');
  lines.push('      stroke: "#E6C200"');
  lines.push('      border-radius: 6');
  lines.push('    }');
  lines.push('  }');
  lines.push('  error: {');
  lines.push('    style: {');
  lines.push('      fill: "#FFE8E8"');
  lines.push('      stroke: "#FF6B6B"');
  lines.push('      border-radius: 6');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  if (!consolidated.runs.length) {
    lines.push('note: "No runs recorded"');
    return lines.join('\n');
  }
  const runIds: string[] = [];
  consolidated.runs.forEach((run, idx) => {
    const runNode = `run_${idx + 1}`;
    runIds.push(runNode);
    const runLabel = `Run ${idx + 1} — ${run.status || 'unknown'}${run.duration_ms != null ? `, ${run.duration_ms}ms` : ''}`;
    lines.push(`${runNode}: {`);
    lines.push(`  label: "${sanitizeLabel(runLabel)}"`);
    lines.push('  direction: down');
    lines.push('  class: runbox');
    const stepNodes: string[] = [];
    const idToNode: Record<string, string> = {};
    const stepById: Record<string, any> = {};
    run.steps.forEach((s) => { stepById[s.step_id] = s; });
    run.steps.forEach((step, sIdx) => {
      const node = `s${sIdx + 1}`; // Scoped inside run box
      idToNode[step.step_id] = node;
      const baseLabel = `${sIdx + 1}. ${step.label || 'step'}${step.duration_ms != null ? ` (${step.duration_ms}ms)` : ''}`;
      const l = (step.label || '').toLowerCase();
      const typeStr = (step.label || '') as ThoughtFlowStepType | string;
      const isAssistantOutput = typeStr === ThoughtFlowStepType.AssistantOutput || l.includes('assistant_output');
      const isToolOutput = !isAssistantOutput && (typeStr === ThoughtFlowStepType.ToolOutput || l.includes('tool_output'));
      const isAssistantCall = typeStr === ThoughtFlowStepType.AssistantCall || l.includes('assistant_call');
      const isToolCall = (!isAssistantCall) && (typeStr === ThoughtFlowStepType.ToolCall || (l.includes('tool_call') || (l.includes('tool') && !isToolOutput && !isAssistantOutput)));
      const snippetCore = (isToolOutput || isAssistantOutput) ? extractToolOutput(step) : (isToolCall || isAssistantCall) ? extractToolSnippet(step) : extractSnippet(step);
      let snippet = snippetCore;
      let toolNameForOutput: string | undefined;
      if (isToolOutput) {
        toolNameForOutput = getToolNameForOutput(step, stepById);
        if (toolNameForOutput && snippetCore) snippet = `tool: ${toolNameForOutput} — ${snippetCore}`;
        else if (toolNameForOutput) snippet = `tool: ${toolNameForOutput}`;
      }
      const klass = isAssistantOutput ? 'assistantout' : isToolOutput ? 'toolout' : isAssistantCall ? 'assistantcall' : isToolCall ? 'tool' : stepClass(step.label);
      // Emit block node with properly terminated |md when snippet exists
      lines.push(`  ${node}: {`);
      // Always use md so we can include the step_id inline
      lines.push('    label: |md');
      lines.push(`      ${sanitizeLabel(baseLabel)}`);
      if (snippet) {
        lines.push('      ---');
        lines.push(`      ${sanitizeLabel(snippet)}`);
      }
      // Append a faint step id line for JSON correlation
      lines.push('      ---');
      lines.push(`      id: \`${sanitizeLabel(step.step_id)}\``);
      lines.push('    |');
      lines.push('    shape: rectangle');
      lines.push(`    class: ${klass}`);
      // Tooltip: include fuller details
      let tip: string | undefined;
      if (isToolOutput || isAssistantOutput) {
        const full = extractToolOutputFull(step) || '';
        const nm = toolNameForOutput || getToolNameForOutput(step, stepById);
        if (isToolOutput) {
          tip = nm ? `tool: ${nm}\n${full}` : full;
        } else {
          const fcs = step.payload_started?.function_calls;
          const hasFunctions = Array.isArray(fcs) && fcs.length > 0;
          let functionsSummary = '';
          if (hasFunctions) {
            const fcLines = fcs.map((fc: any) => `- ${fc.name}(${truncate(fc.args || '', 60)})`);
            functionsSummary = `\n\nFunction Calls:\n${fcLines.join('\n')}`;
          }
          tip = full + functionsSummary;
        }
      }
      else if (isToolCall || isAssistantCall) tip = buildToolTooltip(step);
      else {
        // Snapshots and generic/user/assistant nodes
        tip = buildSnapshotTooltip(step) || extractFullText(step);
      }
      if (tip) lines.push(`    tooltip: "${sanitizeTooltip(tip)}"`);
      lines.push('  }');
      stepNodes.push(node);
    });
    // Build dependency links if present; otherwise fallback to simple chaining
    let anyDeps = false;
    run.steps.forEach((step) => {
      const to = idToNode[step.step_id];
      const deps = (step as any).depends_on as string | string[] | undefined;
      if (deps) {
        anyDeps = true;
        const arr = Array.isArray(deps) ? deps : [deps];
        for (const dep of arr) {
          const from = idToNode[dep];
          if (from && to) lines.push(`  ${from} -> ${to}`);
        }
      }
    });
    if (!anyDeps) {
      for (let i = 1; i < stepNodes.length; i++) {
        lines.push(`  ${stepNodes[i - 1]} -> ${stepNodes[i]}`);
      }
    }
    lines.push('}');
    lines.push('');
  });
  // Chain runs at top level for simple left-to-right overview
  for (let i = 1; i < runIds.length; i++) {
    lines.push(`${runIds[i - 1]} -> ${runIds[i]}`);
  }
  return lines.join('\n');
}

function extractSnippet(step: { label?: string; payload_started?: any; payload_completed?: any }): string | undefined {
  try {
    const lbl = (step.label || '').toLowerCase();
    const ps = step.payload_started || {};
    // Prefer human text
    const text = typeof ps?.text === 'string' ? ps.text
      : typeof ps?.content === 'string' ? ps.content
      : undefined;
    const raw = text || undefined;
    if (!raw) return undefined;
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    if (!collapsed) return undefined;
    return trimToOneSentence(collapsed, 140);
  } catch {
    return undefined;
  }
}

function extractToolSnippet(step: { payload_started?: any }): string | undefined {
  try {
    const ps = step.payload_started || {};
    const name: string | undefined = ps?.name || ps?.tool || ps?.function || undefined;
    let args: any = ps?.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { /* keep as string */ }
    }
    const argsStr = typeof args === 'string' ? args : (args ? JSON.stringify(args) : undefined);
    const lines: string[] = [];
    if (name) lines.push(`tool: ${name}`);
    if (argsStr) lines.push(`args: ${argsStr}`);
    const joined = lines.join('\n');
    if (!joined) return undefined;
    const trimmed = joined.replace(/\s+/g, ' ').trim();
    return trimmed.length > 200 ? trimmed.slice(0, 197) + '…' : trimmed;
  } catch {
    return undefined;
  }
}

function extractToolOutput(step: { label?: string; payload_started?: any; payload_completed?: any }): string | undefined {
  try {
    const ps = step.payload_started || {};
    const pc = step.payload_completed || {};
    // Prefer payload_started.output for explicit tool_output steps; fallback to completed
    let out: any = ps?.output ?? ps?.result ?? ps?.data;
    if (out == null) out = pc?.output ?? pc?.result ?? pc?.data;
    if (out == null) return undefined;
    if (typeof out !== 'string') {
      try { out = JSON.stringify(out); } catch { out = String(out); }
    }
    const s = String(out).replace(/\s+/g, ' ').trim();
    return trimToOneSentence(s, 140);
  } catch {
    return undefined;
  }
}

function extractToolOutputFull(step: { payload_started?: any, payload_completed?: any }): string | undefined {
  try {
    const ps = step.payload_started || {};
    const pc = step.payload_completed || {};
    // AssistantOutput has a 'text' field, ToolOutput has 'output'
    let out: any = ps?.text ?? ps?.output ?? ps?.result ?? ps?.data;
    if (out == null) out = pc?.output ?? pc?.result ?? pc?.data;
    if (out == null) return undefined;
    if (typeof out !== 'string') {
      try { out = JSON.stringify(out, null, 2); } catch { out = String(out); }
    }
    return String(out);
  } catch {
    return undefined;
  }
}

function extractFullText(step: { payload_started?: any }): string | undefined {
  try {
    const ps = step.payload_started || {};
    const text = (typeof ps?.text === 'string' ? ps.text : undefined)
      || (typeof ps?.content === 'string' ? ps.content : undefined);
    return text ? String(text) : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeTooltip(s: string): string {
  // In D2, for a string in quotes, `\n` creates a newline. We must escape backslashes from the content
  // and then convert actual newlines to the `\n` sequence.
  const backslashEscaped = s.replace(/\\/g, '\\\\');
  const quoteEscaped = backslashEscaped.replace(/"/g, "'"); // Use single quotes to avoid escaping hell
  return quoteEscaped.replace(/\n/g, '\\n');
}

function buildToolTooltip(step: { payload_started?: any; duration_ms?: number }): string | undefined {
  const head = extractToolSnippet(step);
  if (!head) return undefined;
  const dur = step.duration_ms != null ? `\nms: ${step.duration_ms}` : '';
  const ps = step.payload_started || {};
  const pp = ps?.prompt_provenance;
  if (!pp) return `${head}${dur}`;
  const parts = Array.isArray(pp.parts) ? pp.parts : [];
  const lines: string[] = [head + dur, '', 'prompt inputs:'];
  parts.forEach((p: any, idx: number) => {
    const t = typeof p?.type === 'string' ? p.type : 'part';
    let v = p?.value;
    if (v == null) v = '';
    if (typeof v !== 'string') {
      try { v = JSON.stringify(v); } catch { v = String(v); }
    }
    const preview = truncate(v, 300);
    lines.push(`- [${idx}] ${t}: ${preview}`);
  });
  if (typeof pp.final_prompt === 'string') {
    lines.push('', `final_prompt (${pp.final_prompt.length} chars)`);
  }
  return lines.join('\n');
}

function buildSnapshotTooltip(step: { label?: string; payload_started?: any }): string | undefined {
  try {
    const lbl = (step.label || '').toLowerCase();
    const ps = step.payload_started || {};
    if (lbl === 'policy.snapshot') {
      const ver = ps?.version ? `version: ${ps.version}` : undefined;
      const produced = ps?.produced_at ? `produced_at: ${ps.produced_at}` : undefined;
      const preview = typeof ps?.content_preview === 'string' ? ps.content_preview : '';
      const lines = ['policy snapshot', ver, produced, '', truncate(preview, 600)].filter(Boolean);
      return lines.join('\n');
    }
    if (lbl === 'tool.schemas.snapshot') {
      const ver = ps?.version ? `version: ${ps.version}` : undefined;
      const count = ps?.count != null ? `tools: ${ps.count}` : undefined;
      const namesArr: string[] = Array.isArray(ps?.names) ? ps.names.slice(0, 20) : [];
      const names = namesArr.length ? `names: ${namesArr.join(', ')}` : undefined;
      const previewRaw = typeof ps?.schemas_preview === 'string' ? ps.schemas_preview : '';
      const preview = previewRaw ? `\n---\n${truncate(previewRaw, 2000)}` : '';
      return ['tools snapshot', ver, count, names].filter(Boolean).join('\n') + preview;
    }
    if (lbl === 'channel.preamble') {
      const ch = ps?.channel ? `channel: ${ps.channel}` : undefined;
      return ['channel preamble', ch].filter(Boolean).join('\n');
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function trimToOneSentence(s: string, maxChars = 140): string {
  const text = String(s).trim();
  const stop = text.search(/[\.!?](\s|$)/);
  let out = stop >= 0 ? text.slice(0, stop + 1) : text.slice(0, maxChars);
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}

function truncate(s: string, max = 300): string {
  const t = String(s);
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function getToolNameForOutput(step: any, stepById: Record<string, any>): string | undefined {
  const deps = (step as any).depends_on as string | string[] | undefined;
  if (!deps) return undefined;
  const first = Array.isArray(deps) ? deps[0] : deps;
  if (!first) return undefined;
  const parent = stepById[first];
  if (!parent) return undefined;
  const ps = parent.payload_started || {};
  return ps?.name || ps?.tool || ps?.function || undefined;
}

function stepClass(label?: string): string {
  const l = (label || '').toLowerCase();
  const t = (label || '') as ThoughtFlowStepType | string;
  // Prefer explicit enum matches first
  if (t === ThoughtFlowStepType.UserMessage) return 'user';
  if (t === ThoughtFlowStepType.AssistantMessage) return 'assistant';
  if (t === ThoughtFlowStepType.AssistantCall) return 'assistantcall';
  if (t === ThoughtFlowStepType.AssistantOutput) return 'assistantout';
  if (t === ThoughtFlowStepType.ToolError) return 'error';
  if (t === ThoughtFlowStepType.ToolOutput) return 'toolout';
  if (t === ThoughtFlowStepType.ToolCall) return 'tool';
  // Fallback heuristics for legacy labels
  if (l.includes('user')) return 'user';
  if (l.includes('assistant_output')) return 'assistantout';
  if (l.includes('assistant_call')) return 'assistantcall';
  if (l.includes('assistant')) return 'assistant';
  if (l.includes('tool_error') || l.includes('error')) return 'error';
  if (l.includes('tool_output')) return 'toolout';
  if (l.includes('tool')) return 'tool';
  return 'tool';
}
