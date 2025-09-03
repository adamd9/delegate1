import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { session } from '../session/state';

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

export function endSession(): { id: string; jsonPath: string } | null {
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
    return { id, jsonPath };
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
    run.steps.forEach((step, sIdx) => {
      const node = `s${sIdx + 1}`; // Scoped inside run box
      const baseLabel = `${sIdx + 1}. ${step.label || 'step'}${step.duration_ms != null ? ` (${step.duration_ms}ms)` : ''}`;
      const isTool = (step.label || '').toLowerCase().includes('tool');
      const snippet = isTool ? extractToolSnippet(step) : extractSnippet(step);
      const klass = isTool ? 'tool' : stepClass(step.label);
      // Emit block node with properly terminated |md when snippet exists
      lines.push(`  ${node}: {`);
      if (snippet) {
        lines.push('    label: |md');
        lines.push(`      ${sanitizeLabel(baseLabel)}`);
        lines.push('      ---');
        lines.push(`      ${sanitizeLabel(snippet)}`);
        lines.push('    |');
      } else {
        lines.push(`    label: "${sanitizeLabel(baseLabel)}"`);
      }
      lines.push('    shape: rectangle');
      lines.push(`    class: ${klass}`);
      // Tooltip: include fuller details
      const tip = isTool ? buildToolTooltip(step) : extractFullText(step);
      if (tip) lines.push(`    tooltip: "${sanitizeTooltip(tip)}"`);
      lines.push('  }');
      // If tool, also emit an output node to the right
      if (isTool) {
        const outNode = `${node}_out`;
        const outSnippet = extractToolOutput(step);
        lines.push(`  ${outNode}: {`);
        if (outSnippet) {
          lines.push('    label: |md');
          lines.push(`      tool_output`);
          lines.push('      ---');
          lines.push(`      ${sanitizeLabel(outSnippet)}`);
          lines.push('    |');
        } else {
          lines.push('    label: "tool_output"');
        }
        lines.push('    shape: rectangle');
        lines.push('    class: toolout');
        const outTip = extractToolOutputFull(step);
        if (outTip) lines.push(`    tooltip: "${sanitizeTooltip(outTip)}"`);
        lines.push('  }');
        // Link call -> output horizontally
        lines.push(`  ${node} -> ${outNode}`);
      }
      stepNodes.push(node);
    });
    // Chain steps within run
    for (let i = 1; i < stepNodes.length; i++) {
      lines.push(`  ${stepNodes[i - 1]} -> ${stepNodes[i]}`);
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
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (!trimmed) return undefined;
    return trimmed.length > 120 ? trimmed.slice(0, 117) + '…' : trimmed;
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

function extractToolOutput(step: { payload_completed?: any }): string | undefined {
  try {
    const pc = step.payload_completed || {};
    let out: any = pc?.output ?? pc?.result ?? pc?.data;
    if (out == null) return undefined;
    if (typeof out !== 'string') {
      try { out = JSON.stringify(out); } catch { out = String(out); }
    }
    const s = String(out).replace(/\s+/g, ' ').trim();
    return s.length > 200 ? s.slice(0, 197) + '…' : s;
  } catch {
    return undefined;
  }
}

function extractToolOutputFull(step: { payload_completed?: any }): string | undefined {
  try {
    const pc = step.payload_completed || {};
    let out: any = pc?.output ?? pc?.result ?? pc?.data;
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
  // Escape backslashes, quotes and newlines for inline D2 string
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function buildToolTooltip(step: { payload_started?: any; duration_ms?: number }): string | undefined {
  const head = extractToolSnippet(step);
  if (!head) return undefined;
  const dur = step.duration_ms != null ? `\nms: ${step.duration_ms}` : '';
  return `${head}${dur}`;
}

function stepClass(label?: string): string {
  const l = (label || '').toLowerCase();
  if (l.includes('user')) return 'user';
  if (l.includes('assistant')) return 'assistant';
  if (l.includes('tool_error') || l.includes('error')) return 'error';
  if (l.includes('tool')) return 'tool';
  return 'tool';
}
