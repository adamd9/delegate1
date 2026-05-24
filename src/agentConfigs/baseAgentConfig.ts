import { AgentConfig } from './types';
// import { getWeatherFunction } from '../tools/handlers/weather';
import { sendSmsTool } from '../tools/handlers/sms';
import { callUserTool } from '../tools/handlers/call';
import { sendEmailTool } from '../tools/handlers/email';
import { createNoteFunction, listNotesFunction, updateNoteFunction, deleteNoteFunction, getNoteFunction } from '../tools/handlers/notes';
import { hangupCallTool } from '../tools/handlers/hangup';
import { agentPersonality } from "./personality";
import { composeBaseInstructions } from "./prompts";
import { listAdaptationsFunction, getAdaptationFunction, updateAdaptationFunction, reloadAdaptationsFunction } from '../tools/handlers/adaptations';
import { setVoiceNoiseModeTool } from '../tools/handlers/voice-noise-mode';
import { listGithubReposFunction, createGithubIssueFunction } from '../tools/handlers/github';
import { retrieveMemoryFunction, storeMemoryFunction } from '../tools/handlers/memory';

// Base Agent Configuration.
//
// `instructions` is defined via Object.defineProperty (below) as a getter
// so every read returns the freshly composed personality + operational
// instructions from `prompts.ts`. This lets the settings UI edit either
// prompt at runtime and have the change take effect on the very next model
// call without needing to restart any subsystem.
export const baseAgentConfig: AgentConfig = {
  name: "delegate_base",
  instructions: '', // overridden by the defineProperty getter below
  voice: agentPersonality.voice,
  tools: [
    sendSmsTool,
    callUserTool,
    sendEmailTool,
    createNoteFunction,
    listNotesFunction,
    updateNoteFunction,
    deleteNoteFunction,
    getNoteFunction,
    // Prompt Adaptations management tools
    listAdaptationsFunction,
    getAdaptationFunction,
    updateAdaptationFunction,
    reloadAdaptationsFunction,
    hangupCallTool,
    setVoiceNoiseModeTool,
    // GitHub interaction tools
    listGithubReposFunction,
    createGithubIssueFunction,
    // Explicit memory tools (adaptive backend only)
    retrieveMemoryFunction,
    storeMemoryFunction,
  ],
  // Text (Responses API) model for chat interactions
  textModel: "gpt-5-mini",
  // Voice (Realtime API) model for call interactions
  voiceModel: "gpt-realtime-1.5",
  // Backward compat: keep model; align it with voice model by default
  model: "gpt-realtime-1.5",
  temperature: 0.8,
  // Reasoning effort for text (Responses API) calls
  reasoning: { effort: 'low' },
};

Object.defineProperty(baseAgentConfig, 'instructions', {
  get: composeBaseInstructions,
  enumerable: true,
  configurable: false,
});
