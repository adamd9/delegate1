#!/usr/bin/env node

// scripts/localtunnel.js
// Starts localtunnel for backend server if CODEX_CLI is 'true'.
const { HttpProxyAgent } = require('http-proxy-agent');
const localtunnel = require('localtunnel');
const fs = require('fs');

const PORT = process.env.PORT || 8081;
const CODEX_CLI = process.env.CODEX_CLI;
const CODEX_PROXY_CERT = process.env.CODEX_PROXY_CERT;

const agent = new HttpProxyAgent(process.env.HTTP_PROXY);

async function getTunnelPassword() {
  try {
    const res = await fetch('http://ipv4.icanhazip.com', { agent });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.trim();
  } catch (err) {
    console.error('[localtunnel] Failed to fetch tunnel password:', err);
    return null;
  }
}

(async () => {
try {
    // Prepare localtunnel options
    const ltOptions = { port: PORT, subdomain: undefined };
    if (CODEX_PROXY_CERT && fs.existsSync(CODEX_PROXY_CERT)) {
    ltOptions.local_ca = CODEX_PROXY_CERT;
    console.log(`[localtunnel] Using local_ca: ${CODEX_PROXY_CERT}`);
    } else if (CODEX_PROXY_CERT) {
    console.warn(`[localtunnel] CODEX_PROXY_CERT set but file does not exist: ${CODEX_PROXY_CERT}`);
    }
    // Fetch password
    // const password = await getTunnelPassword();
    // if (password) {
    // console.log(`\n[localtunnel] Tunnel password: ${password}`);
    // }
    const tunnel = await localtunnel(ltOptions);
    console.log(`\n[localtunnel] Public URL: ${tunnel.url}`);
    tunnel.on('close', () => {
    console.log('[localtunnel] Tunnel closed');
    });
    // Keep process alive
} catch (err) {
    console.error('[localtunnel] Failed to start:', err);
    process.exit(1);
}
})();
