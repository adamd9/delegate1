#!/usr/bin/env node
// Enable TypeScript support for importing backend modules
require('../websocket-server/node_modules/ts-node/register');
const { handleTextChatMessage } = require('../websocket-server/src/session/chat');
const WebSocket = require('../websocket-server/node_modules/ws');

class MockWebSocket {
  constructor() {
    this.readyState = WebSocket.OPEN;
    this.messages = [];
  }
  send(data) {
    this.messages.push(data);
  }
}

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('Usage: npm run ask -- "Your question"');
    process.exit(1);
  }

  const chatSocket = new MockWebSocket();
  const logsSocket = new MockWebSocket();

  const chatClients = new Set([chatSocket]);
  const logsClients = new Set([logsSocket]);

  await handleTextChatMessage(question, chatClients, logsClients);

  // Output chat responses
  for (const msg of chatSocket.messages) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'chat.response') {
        console.log(parsed.content);
      } else if (parsed.type === 'chat.error') {
        console.error('Error:', parsed.error);
      }
    } catch (err) {
      console.log(msg);
    }
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
