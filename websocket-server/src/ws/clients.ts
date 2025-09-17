import { WebSocket } from 'ws';

// Centralized WebSocket client registries
export const chatClients = new Set<WebSocket>();
// Alias logsClients to chatClients so existing emitters continue to work
export const logsClients = chatClients;
