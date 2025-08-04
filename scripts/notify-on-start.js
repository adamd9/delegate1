#!/usr/bin/env node
// Wait for specified servers to become available and send a notification
// using a custom endpoint defined via environment variables.

const endpoint = process.env.CALL_MY_PHONE_ENDPOINT;
const secret = process.env.CALL_MY_PHONE_SECRET;
const message = process.env.STARTUP_NOTIFY_MESSAGE || 'Servers started successfully';

async function waitFor(url) {
  // Poll the given URL until it responds without error.
  // Uses HEAD requests to minimize data transfer.
  while (true) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return;
    } catch (err) {
      // Ignore errors and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function notify(msg) {
  if (!endpoint || !secret) {
    console.log('Notification skipped: CALL_MY_PHONE_ENDPOINT or CALL_MY_PHONE_SECRET not set');
    return;
  }
  try {
    // Create Basic Auth header with secret as username, blank password
    const basicAuth = Buffer.from(`user:${secret}`).toString('base64');
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`
      },
      body: JSON.stringify({ message: msg }),
    });
    if (!resp.ok) {
      console.error('Failed to send notification:', resp.status, await resp.text());
    } else {
      console.log('Startup notification sent');
    }
  } catch (err) {
    console.error('Failed to send notification:', err.message);
  }
}

(async () => {
  try {
    await notify(message);
  } catch (err) {
    console.error('Error sending notification:', err.message);
  }
})();

