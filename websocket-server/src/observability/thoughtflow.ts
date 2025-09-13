import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { session } from '../session/state';
import { upsertSession, finalizeSession, upsertRun, completeRun, stepStarted, stepCompleted, addTranscriptItem, getLastTranscriptTimestamp } from '../db/sqlite';

// Explicit step types for ThoughtFlow events
export enum ThoughtFlowStepType {
  UserMessage = 'user_message',
  AssistantMessage = 'assistant_message',
  AssistantCall = 'assistant_call',
  ToolCall = 'tool_call',
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
  try {
    // Ensure a DB session row exists
    upsertSession(tf.sessionId, new Date(tf.startedAt!).toISOString());
  } catch {}
  return { id: tf.sessionId, jsonlPath };
}

export function appendEvent(event: any) {
  try {
    const { jsonlPath } = ensureSession();
    appendFileSync(jsonlPath, JSON.stringify(event) + '\n');
    // Mirror to SQLite best-effort
    try {
      const tf = (session.thoughtflow || {}) as any;
      const sid = tf.sessionId as string | undefined;
      if (sid) {
        const t = event?.type as string | undefined;
        if (t === 'run.started') {
          upsertRun({ id: event.run_id, session_id: sid, channel: event.channel, started_at: event.started_at });
        } else if (t === 'run.completed' || t === 'run.aborted') {
          const status = (event.status as any) || (t === 'run.aborted' ? 'aborted' : 'completed');
          completeRun({ id: event.run_id, status, ended_at: event.ended_at });
          // Generate per-run ThoughtFlow artifacts at run completion
          try {
            const { jsonPath: runJson, d2Path: runD2 } = writeRunArtifacts(sid, event.run_id);
            const PORT = parseInt(process.env.PORT || '8081', 10);
            const PUBLIC_URL = process.env.PUBLIC_URL || '';
            const EFFECTIVE_PUBLIC_URL = (PUBLIC_URL && PUBLIC_URL.trim()) || `http://localhost:${PORT}`;
            const baseName = `${sid}.${event.run_id}`;
            const url_json = `${EFFECTIVE_PUBLIC_URL}/thoughtflow/${baseName}.json`;
            const url_d2 = `${EFFECTIVE_PUBLIC_URL}/thoughtflow/${baseName}.d2`;
            const url_d2_raw = `${EFFECTIVE_PUBLIC_URL}/thoughtflow/raw/${baseName}.d2`;
            // Viewer lives on the frontend, so use a relative link instead of server URL
            const url_d2_viewer = `/thoughtflow/viewer/${sid}`; // session-level viewer still useful
            const lastTs = getLastTranscriptTimestamp(sid) || Date.now();
            addTranscriptItem({
              id: `ti_tf_run_${event.run_id}`,
              session_id: sid,
              kind: 'thoughtflow_artifacts',
              payload: { session_id: sid, run_id: event.run_id, url_json, url_d2, url_d2_raw, url_d2_viewer },
              created_at_ms: lastTs + 1,
            });
          } catch {}
        } else if (t === 'step.started') {
          stepStarted({ id: event.step_id, run_id: event.run_id, label: event.label, started_at: event.timestamp ? new Date(event.timestamp).toISOString() : undefined, payload_started_json: event.payload ? JSON.stringify(event.payload) : undefined });
        } else if (t === 'step.completed') {
          stepCompleted({ id: event.step_id, ended_at: event.timestamp ? new Date(event.timestamp).toISOString() : undefined, payload_completed_json: event.payload ? JSON.stringify(event.payload) : undefined });
        }
      }
    } catch {}
  } catch (e) {
    console.warn('[thoughtflow] appendEvent failed:', (e as any)?.message || e);
  }
}

function writeRunArtifacts(sessionId: string, runId: string): { jsonPath: string; d2Path: string } {
  const tf = (session.thoughtflow ||= {} as any);
  const jsonlPath = join(BASE_DIR, `${sessionId}.jsonl`);
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
  const run: any = { run_id: runId, steps: [], _stepIndex: {} };
  for (const line of lines) {
    let evt: any; try { evt = JSON.parse(line); } catch { continue; }
    const t = evt?.type as string | undefined; if (!t) continue;
    if ((t === 'run.started' || t === 'run.completed' || t === 'run.aborted') && evt.run_id === runId) {
      if (t === 'run.started') {
        run.started_at = evt.started_at || new Date().toISOString();
        if (evt.channel) run.channel = evt.channel;
      } else {
        run.ended_at = evt.ended_at || new Date().toISOString();
        run.status = (evt.status as any) || (t === 'run.aborted' ? 'aborted' : 'completed');
      }
      continue;
    }
    if ((t === 'step.started' || t === 'step.completed') && evt.run_id === runId) {
      if (t === 'step.started') {
        const s: Step = {
          step_id: evt.step_id,
          label: evt.label,
          started_at: evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString(),
          payload_started: evt.payload,
        };
        if (evt.depends_on) (s as any).depends_on = evt.depends_on;
        run.steps.push(s);
        run._stepIndex[evt.step_id] = s;
      } else {
        const s = run._stepIndex[evt.step_id];
        if (s) {
          s.ended_at = evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString();
          s.payload_completed = evt.payload;
        }
      }
    }
  }
  // Compute durations and sanitize
  for (const s of run.steps) {
    if (s.started_at && s.ended_at) s.duration_ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
  }
  if (run.started_at && run.ended_at) run.duration_ms = new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
  if (!run.status) run.status = 'unknown';
  const consolidated = {
    session_id: sessionId,
    started_at: new Date((tf.startedAt as any) || Date.now()).toISOString(),
    ended_at: new Date().toISOString(),
    runs: [
      {
        run_id: run.run_id,
        channel: run.channel,
        status: run.status,
        started_at: run.started_at,
        ended_at: run.ended_at,
        duration_ms: run.duration_ms,
        steps: run.steps.sort((a: any, b: any) => String(a.started_at).localeCompare(String(b.started_at))).map(({ _stepIndex, ...s }: any) => s),
      },
    ],
  } as const;
  const baseName = `${sessionId}.${runId}`;
  const jsonPath = join(BASE_DIR, `${baseName}.json`);
  writeFileSync(jsonPath, JSON.stringify(consolidated, null, 2));
  const d2 = generateD2(consolidated as any);
  const d2Path = join(BASE_DIR, `${baseName}.d2`);
  writeFileSync(d2Path, d2);
  return { jsonPath, d2Path };
}

export function endSession(opts?: { statusOverride?: string; sessionId?: string }): { id: string; jsonPath: string; d2Path: string } | null {
  try {
    const tf = (session.thoughtflow ||= {} as any);
    const active = ensureSession();
    const id = opts?.sessionId || active.id;
    const jsonlPath = opts?.sessionId ? join(BASE_DIR, `${opts.sessionId}.jsonl`) : active.jsonlPath;
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
      started_at: new Date((tf.startedAt as any) || Date.now()).toISOString(),
      ended_at: new Date().toISOString(),
      runs,
    } as const;
    writeFileSync(jsonPath, JSON.stringify(consolidated, null, 2));
    // Generate a simple D2 diagram for the session
    const d2 = generateD2(consolidated);
    const d2Path = join(BASE_DIR, `${id}.d2`);
    writeFileSync(d2Path, d2);
    appendFileSync(jsonlPath, JSON.stringify({ type: 'session.ended', session_id: id, ended_at: consolidated.ended_at }) + '\n');
    // Finalize in DB with a derived session status
    try {
      const sessionStatus = deriveSessionStatus(runs as any) || 'completed';
      finalizeSession(id, opts?.statusOverride || sessionStatus, consolidated.ended_at);
    } catch {}
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
      const typeStr = (step.label || '') as ThoughtFlowStepType | string;
      const isAssistantCall = typeStr === ThoughtFlowStepType.AssistantCall;
      const isToolCall = typeStr === ThoughtFlowStepType.ToolCall;

      let snippet: string | undefined;
      if (isAssistantCall || isToolCall) {
        const callSnippet = extractToolSnippet(step);
        const outputSnippet = extractToolOutput(step);
        if (callSnippet && outputSnippet) {
          snippet = `input: ${callSnippet}\noutput: ${outputSnippet}`;
        } else {
          snippet = callSnippet || outputSnippet;
        }
      } else {
        snippet = extractSnippet(step);
      }

      const klass = stepClass(step.label);
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
      if (isAssistantCall || isToolCall) {
        tip = buildToolTooltip(step);
      } else {
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

function extractSnippet(step: { payload_started?: any }): string | undefined {
  try {
    const ps = step.payload_started || {};
    const text = (typeof ps?.text === 'string' ? ps.text : undefined) || (typeof ps?.content === 'string' ? ps.content : undefined);
    if (!text) return undefined;
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return trimToOneSentence(collapsed, 140);
  } catch {
    return undefined;
  }
}

function extractToolSnippet(step: { label?: string; payload_started?: any }): string | undefined {
  try {
    const ps = step.payload_started || {};
    if (step.label === ThoughtFlowStepType.AssistantCall) {
      const preview = ps.arguments?.instructions_preview;
      return preview ? `LLM Request: ${trimToOneSentence(preview, 100)}` : 'LLM Request';
    }

    const name: string | undefined = ps?.name || ps?.tool || ps?.function;
    const argsStr = ps?.arguments ? truncate(JSON.stringify(ps.arguments), 80) : '';
    if (!name) return undefined;

    const line = `tool: ${name}(${argsStr})`;
    return line.replace(/\s+/g, ' ').trim();
  } catch {
    return undefined;
  }
}

function extractToolOutput(step: { label?: string; payload_completed?: any }): string | undefined {
  try {
    const pc = step.payload_completed || {};
    let out: any;

    if (step.label === ThoughtFlowStepType.AssistantCall) {
      if (pc.text) {
        out = pc.text;
      } else if (Array.isArray(pc.function_calls) && pc.function_calls.length > 0) {
        return `Calls: ${pc.function_calls.map((fc: any) => fc.name).join(', ')}`;
      }
    } else {
      out = pc?.output ?? pc?.result ?? pc?.data;
    }

    if (out == null) return undefined;
    const s = typeof out === 'string' ? out : JSON.stringify(out);
    return trimToOneSentence(s.replace(/\s+/g, ' ').trim(), 140);
  } catch {
    return undefined;
  }
}

function extractToolOutputFull(step: { label?: string; payload_completed?: any }): string | undefined {
  try {
    const pc = step.payload_completed || {};
    let out: any;

    if (step.label === ThoughtFlowStepType.AssistantCall) {
      out = pc.text;
    } else {
      out = pc?.output ?? pc?.result ?? pc?.data;
    }

    if (out == null) return undefined;
    return typeof out === 'string' ? out : JSON.stringify(out, null, 2);
  } catch {
    return undefined;
  }
}

function buildToolTooltip(step: { label?: string, payload_started?: any; payload_completed?: any; duration_ms?: number }): string | undefined {
  const head = extractToolSnippet(step);
  if (!head) return undefined;
  const dur = step.duration_ms != null ? `\nms: ${step.duration_ms}` : '';

  let tooltip = `${head}${dur}`;

  const ps = step.payload_started || {};
  const pc = step.payload_completed || {};

  // For Assistant Calls, add prompt provenance
  if (step.label === ThoughtFlowStepType.AssistantCall && ps.prompt_provenance) {
    const pp = ps.prompt_provenance;
    const parts = Array.isArray(pp.parts) ? pp.parts : [];
    const promptHead = `\n\nPrompt (${pp.token_count || '...'} tokens):\n${'-'.repeat(20)}`;
    const promptParts = parts.map((p: any, i: number) => {
      // Use a more descriptive fallback label
      const label = p.label || (i === 0 ? 'system_prompt' : `message_${i}`);
      return `[${label}]\n${truncate(String(p.content || ''), 400)}`;
    }).join('\n\n');
    tooltip += `${promptHead}\n${promptParts}`;
  }

  // For Assistant Calls, add output text and function calls
  if (step.label === ThoughtFlowStepType.AssistantCall) {
    if (pc.text) {
      tooltip += `\n\nOutput Text:\n${'-'.repeat(20)}\n${pc.text}`;
    }
    if (Array.isArray(pc.function_calls) && pc.function_calls.length > 0) {
      const fcLines = pc.function_calls.map((fc: any) => `- ${fc.name}(${truncate(JSON.stringify(fc.args) || '', 120)})`);
      tooltip += `\n\nFunction Calls:\n${'-'.repeat(20)}\n${fcLines.join('\n')}`;
    }
  } else {
    // For regular Tool Calls, add the output
    const toolOutput = extractToolOutputFull(step);
    if (toolOutput) {
      tooltip += `\n\nOutput:\n${'-'.repeat(20)}\n${toolOutput}`;
    }
  }

  return tooltip;
}

function buildSnapshotTooltip(step: { label?: string; payload_started?: any }): string | undefined {
  try {
    const lbl = (step.label || '').toLowerCase();
    if (lbl.includes('snapshot')) {
      const ps = step.payload_started || {};
      const lines = [
        `version: ${ps.version || 'n/a'}`, 
        `produced_at: ${ps.produced_at || 'n/a'}`,
      ];
      if (ps.count != null) lines.push(`count: ${ps.count}`);
      if (Array.isArray(ps.names)) {
        lines.push(`names: ${ps.names.slice(0, 20).join(', ')}`);
      }
      if (ps.schemas_preview) {
        lines.push('', 'schemas_preview:', ps.schemas_preview);
      }
      return lines.join('\n');
    }
    return undefined;
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

function stepClass(label?: string): string {
  const l = (label || '').toLowerCase();
  const t = (label || '') as ThoughtFlowStepType | string;
  // Prefer explicit enum matches first
  if (t === ThoughtFlowStepType.UserMessage) return 'user';
  if (t === ThoughtFlowStepType.AssistantMessage) return 'assistant';
  if (t === ThoughtFlowStepType.AssistantCall) return 'assistantcall';
  if (t === ThoughtFlowStepType.ToolError) return 'error';
  if (t === ThoughtFlowStepType.ToolCall) return 'tool';
  // Fallback heuristics for legacy labels
  if (l.includes('user')) return 'user';
  if (l.includes('assistant_call')) return 'assistantcall';
  if (l.includes('assistant')) return 'assistant';
  if (l.includes('tool_error') || l.includes('error')) return 'error';
  if (l.includes('tool')) return 'tool';
  return 'tool';
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

function deriveSessionStatus(runs: Array<{ status?: string }>): string {
  try {
    const statuses = runs.map(r => (r.status || '').toLowerCase());
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('aborted')) return 'aborted';
    if (statuses.every(s => s === 'completed')) return 'completed';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
