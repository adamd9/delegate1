// Keep this file as a compatibility hub for base agent exports only
// Tools are now centralized under src/tools/handlers/*
export { baseAgentConfig as baseAgent } from './baseAgentConfig';
export { sendCanvas } from '../tools/handlers/canvas';
export { sendSmsTool } from '../tools/handlers/sms';
export { getWeatherFunction } from '../tools/handlers/weather';
