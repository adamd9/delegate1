import { registerTools, ToolOrigin } from "../registry";
import { sendSmsTool } from "../handlers/sms";
import { sendEmailTool } from "../handlers/email";
import { getNextResponseFromSupervisorFunction } from "../handlers/supervisor-escalation";
import { createNoteFunction, listNotesFunction, updateNoteFunction, deleteNoteFunction, getNoteFunction } from "../handlers/notes";
import { setVoiceNoiseModeTool } from "../handlers/voice-noise-mode";
import { listAdaptationsFunction, getAdaptationFunction, updateAdaptationFunction, reloadAdaptationsFunction } from "../handlers/adaptations";
import { hangupCallTool } from "../handlers/hangup";
import { listGithubReposFunction, createGithubIssueFunction, startCopilotAgentSessionFunction } from "../handlers/github";
import { retrieveMemoryFunction, storeMemoryFunction } from "../handlers/memory";

function wrap(name: string, description: string, parameters: any, origin: ToolOrigin, tags: string[], handler: (args: any) => Promise<any>) {
  return {
    name,
    description,
    parameters,
    origin,
    tags,
    handler: async (args: any) => {
      try {
        const out = await handler(args);
        if (typeof out === 'string') return out;
        try { return JSON.stringify(out); } catch { return String(out); }
      } catch (e: any) {
        // Generic protection: never let tool handler throw out of the registry layer
        const errMsg = e?.message || String(e);
        return JSON.stringify({ error: errMsg });
      }
    }
  };
}

export function registerLocalTools() {
  const providerId = 'local';
  const tools = [
    // Base agent escalation entrypoint to supervisor
    wrap(
      getNextResponseFromSupervisorFunction.schema.name,
      getNextResponseFromSupervisorFunction.schema.description,
      getNextResponseFromSupervisorFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => getNextResponseFromSupervisorFunction.handler(args)
    ),
    wrap(
      sendSmsTool.schema.name,
      sendSmsTool.schema.description,
      sendSmsTool.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => sendSmsTool.handler(args)
    ),
    wrap(
      createNoteFunction.schema.name,
      createNoteFunction.schema.description,
      createNoteFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => createNoteFunction.handler(args)
    ),
    wrap(
      listNotesFunction.schema.name,
      listNotesFunction.schema.description,
      listNotesFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => listNotesFunction.handler(args)
    ),
    wrap(
      updateNoteFunction.schema.name,
      updateNoteFunction.schema.description,
      updateNoteFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => updateNoteFunction.handler(args)
    ),
    wrap(
      deleteNoteFunction.schema.name,
      deleteNoteFunction.schema.description,
      deleteNoteFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => deleteNoteFunction.handler(args)
    ),
    wrap(
      setVoiceNoiseModeTool.schema.name,
      setVoiceNoiseModeTool.schema.description,
      setVoiceNoiseModeTool.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => setVoiceNoiseModeTool.handler(args)
    ),
    wrap(
      sendEmailTool.schema.name,
      sendEmailTool.schema.description,
      sendEmailTool.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => sendEmailTool.handler(args)
    ),
    wrap(
      getNoteFunction.schema.name,
      getNoteFunction.schema.description,
      getNoteFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => getNoteFunction.handler(args)
    ),
    wrap(
      listAdaptationsFunction.schema.name,
      listAdaptationsFunction.schema.description,
      listAdaptationsFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => listAdaptationsFunction.handler(args)
    ),
    wrap(
      getAdaptationFunction.schema.name,
      getAdaptationFunction.schema.description,
      getAdaptationFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => getAdaptationFunction.handler(args)
    ),
    wrap(
      updateAdaptationFunction.schema.name,
      updateAdaptationFunction.schema.description,
      updateAdaptationFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => updateAdaptationFunction.handler(args)
    ),
    wrap(
      reloadAdaptationsFunction.schema.name,
      reloadAdaptationsFunction.schema.description,
      reloadAdaptationsFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => reloadAdaptationsFunction.handler(args)
    ),
    wrap(
      hangupCallTool.schema.name,
      hangupCallTool.schema.description,
      hangupCallTool.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => hangupCallTool.handler(args)
    ),
    wrap(
      listGithubReposFunction.schema.name,
      listGithubReposFunction.schema.description,
      listGithubReposFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => listGithubReposFunction.handler(args)
    ),
    wrap(
      createGithubIssueFunction.schema.name,
      createGithubIssueFunction.schema.description,
      createGithubIssueFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => createGithubIssueFunction.handler(args)
    ),
    wrap(
      startCopilotAgentSessionFunction.schema.name,
      startCopilotAgentSessionFunction.schema.description,
      startCopilotAgentSessionFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => startCopilotAgentSessionFunction.handler(args)
    ),
    wrap(
      retrieveMemoryFunction.schema.name,
      retrieveMemoryFunction.schema.description,
      retrieveMemoryFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => retrieveMemoryFunction.handler(args)
    ),
    wrap(
      storeMemoryFunction.schema.name,
      storeMemoryFunction.schema.description,
      storeMemoryFunction.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => storeMemoryFunction.handler(args)
    ),
  ];

  registerTools(providerId, tools);
}
