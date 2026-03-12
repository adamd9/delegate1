// Keep this file as a compatibility hub for base agent exports only
// Tools are now centralized under src/tools/handlers/*
export { baseAgentConfig as baseAgent } from './baseAgentConfig';
export { sendSmsTool } from '../tools/handlers/sms';
