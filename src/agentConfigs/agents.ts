import { baseAgent } from './baseAgent';
import { webSearchFunction } from '../tools/handlers/web-search';

// Base agent gains the web_search tool (wraps OpenAI Responses builtin web_search).
export const delegate1Agent = {
  ...baseAgent,
  tools: [
    ...baseAgent.tools,
    webSearchFunction,
  ],
};

export const agents = {
  base: delegate1Agent,
};

// Default agent is the base agent
export const defaultAgent = delegate1Agent;
