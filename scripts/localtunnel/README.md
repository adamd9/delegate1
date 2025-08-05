# Localtunnel Helper Options

This directory contains helper scripts for starting the development tunnel.
Choose the one that best fits your environment.

## 1. `start-localtunnel.sh`
Bash wrapper that runs `../localtunnel.js` in the background.
It waits for the public URL to appear, prints the startup log, and then
detaches the process.

```bash
CODEX_CLI=true scripts/localtunnel/start-localtunnel.sh
```

Logs are written to `scripts/localtunnel/localtunnel.log`.

## 2. `spawn-localtunnel.js`
Node script that spawns `../localtunnel.js`, streams its initial output,
then detaches so other tasks can continue.

```bash
CODEX_CLI=true node scripts/localtunnel/spawn-localtunnel.js
```

## 3. `inline-localtunnel.js`
Starts the tunnel directly using the `localtunnel` package. Useful when you
want to embed tunneling inside your setup process and continue with other
JavaScript tasks.

```bash
node scripts/localtunnel/inline-localtunnel.js
```

All scripts respect `CODEX_PROXY_CERT` and `HTTP_PROXY` if set. The first two
options require `CODEX_CLI=true` because they wrap `scripts/localtunnel.js`.
