#!/usr/bin/env node
// Spawn localtunnel.js and detach after showing startup output.
const { spawn } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, '..', 'localtunnel.js');
const lt = spawn('node', [scriptPath], {
  detached: true,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let buffer = '';
lt.stdout.on('data', chunk => {
  const text = chunk.toString();
  buffer += text;
  process.stdout.write(text);
  if (buffer.includes('Public URL')) {
    lt.stdout.destroy();
    lt.unref();
    lt.stdout.unref();
  }
});
