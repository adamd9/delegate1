#!/usr/bin/env node
// Start localtunnel directly inside this script.
const { HttpProxyAgent } = require('http-proxy-agent');
const localtunnel = require('localtunnel');
const fs = require('fs');

const PORT = process.env.PORT || 8081;
const CODEX_PROXY_CERT = process.env.CODEX_PROXY_CERT;
const agent = new HttpProxyAgent(process.env.HTTP_PROXY);

async function getTunnelPassword() {
  try {
    const res = await fetch('http://ipv4.icanhazip.com', { agent });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.trim();
  } catch (err) {
    console.error('[inline-localtunnel] Failed to fetch tunnel password:', err);
    return null;
  }
}

(async () => {
  try {
    const ltOptions = { port: PORT, subdomain: undefined };
    if (CODEX_PROXY_CERT && fs.existsSync(CODEX_PROXY_CERT)) {
      ltOptions.local_ca = CODEX_PROXY_CERT;
      console.log(`[inline-localtunnel] Using local_ca: ${CODEX_PROXY_CERT}`);
    } else if (CODEX_PROXY_CERT) {
      console.warn(`[inline-localtunnel] CODEX_PROXY_CERT set but file does not exist: ${CODEX_PROXY_CERT}`);
    }
    const password = await getTunnelPassword();
    if (password) {
      console.log(`\n[inline-localtunnel] Tunnel password: ${password}`);
    }
    const tunnel = await localtunnel(ltOptions);
    console.log(`\n[inline-localtunnel] Public URL: ${tunnel.url}`);
    // Continue with other setup tasks while tunnel stays open
  } catch (err) {
    console.error('[inline-localtunnel] Failed to start:', err);
    process.exit(1);
  }
})();
