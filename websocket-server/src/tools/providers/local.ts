import { registerTools, ToolOrigin } from "../registry";
import { sendCanvas } from "../handlers/canvas";
import { sendSmsTool } from "../handlers/sms";
import { getNextResponseFromSupervisorFunction } from "../handlers/supervisor-escalation";
import { memAddFunction, memSearchFunction } from "../handlers/mem0";
import { createNoteFunction, listNotesFunction, updateNoteFunction, deleteNoteFunction } from "../handlers/notes";

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
      sendCanvas.schema.name,
      sendCanvas.schema.description,
      sendCanvas.schema.parameters,
      'local',
      ['local', 'base-default'],
      (args) => sendCanvas.handler(args)
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
  ];

  // Conditionally register Mem0 tools only when API key is configured
  if (process.env.MEM0_API_KEY) {
    tools.push(
      wrap(
        memAddFunction.schema.name,
        memAddFunction.schema.description,
        memAddFunction.schema.parameters,
        'local',
        ['local', 'base-default'],
        (args) => memAddFunction.handler(args)
      )
    );
    tools.push(
      wrap(
        memSearchFunction.schema.name,
        memSearchFunction.schema.description,
        memSearchFunction.schema.parameters,
        'local',
        ['local', 'base-default'],
        (args) => memSearchFunction.handler(args)
      )
    );
  } else {
    console.warn('[tools] Skipping Mem0 tools: MEM0_API_KEY not set');
  }
  registerTools(providerId, tools);
}
