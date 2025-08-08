#!/usr/bin/env node

/**
 * TwiML Application Updater for Delegate 1 (DEV)
 * 
 * Automatically updates the TwiML Application's Voice URL to point to the
 * websocket-server PUBLIC_URL + "/twiml" so ngrok restarts are a one-liner.
 * 
 * Reads config from: websocket-server/.env by default.
 * Override with: node scripts/twilio/update-twiml-app.js --env path/to/.env
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const twilio = require('twilio');

function loadEnv(envPathArg) {
  const defaultPath = path.resolve(__dirname, '../../websocket-server/.env');
  const envPathIndex = process.argv.findIndex((a) => a === '--env');
  const envPath = envPathArg || (envPathIndex !== -1 ? process.argv[envPathIndex + 1] : defaultPath);

  if (!fs.existsSync(envPath)) {
    throw new Error(`.env not found at ${envPath}`);
  }
  dotenv.config({ path: envPath });
  return envPath;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function buildVoiceUrl(publicUrl) {
  const base = publicUrl.replace(/\/$/, '');
  return `${base}/twiml`;
}

async function updateTwiMLApplication() {
  console.log('🔧 Updating TwiML Application from websocket-server/.env');
  let envPathUsed;
  try {
    envPathUsed = loadEnv();
    console.log(`📄 Loaded env: ${envPathUsed}`);

    const accountSid = required('TWILIO_ACCOUNT_SID');
    const apiKeySid = required('TWILIO_API_KEY_SID');
    const apiKeySecret = required('TWILIO_API_KEY_SECRET');
    const appSid = required('TWILIO_TWIML_APP_SID');
    const publicUrl = required('PUBLIC_URL');

    const newVoiceUrl = buildVoiceUrl(publicUrl);

    // AU1 region + Sydney edge for Voice
    const client = twilio(apiKeySid, apiKeySecret, {
      accountSid,
      region: 'au1',
      edge: 'sydney',
    });

    console.log('🔍 Fetching current application details...');
    const currentApp = await client.applications(appSid).fetch();

    console.log('📋 Current Application:');
    console.log(`   Friendly Name: ${currentApp.friendlyName}`);
    console.log(`   Current Voice URL: ${currentApp.voiceUrl}`);
    console.log('');

    console.log('🔄 Updating TwiML Application...');
    console.log(`   Application SID: ${appSid}`);
    console.log(`   New Voice URL:   ${newVoiceUrl}`);

    const updatedApp = await client.applications(appSid).update({
      voiceUrl: newVoiceUrl,
      voiceMethod: 'POST',
    });

    console.log('✅ TwiML Application updated successfully!');
    console.log('');
    console.log('📋 Updated Application:');
    console.log(`   Application SID: ${updatedApp.sid}`);
    console.log(`   Voice URL:       ${updatedApp.voiceUrl}`);
    console.log(`   Voice Method:    ${updatedApp.voiceMethod}`);
    console.log('');

    console.log('💡 Tip: Run this script after each ngrok restart to sync URLs.');
  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.log('❌ Failed to update TwiML Application');
    console.log('   Error:', error.message);
    if (envPathUsed) console.log(`   Loaded env: ${envPathUsed}`);
    console.log('\n🔧 Checks:');
    console.log('   - TWILIO_* credentials present in websocket-server/.env');
    console.log('   - TWILIO_TWIML_APP_SID is correct for DEV');
    console.log('   - PUBLIC_URL looks like https://<ngrok>.ngrok-free.app');
    console.log('   - API Key has permission to update Applications');
  }
}

// Run the update
if (require.main === module) {
  updateTwiMLApplication();
}

module.exports = { updateTwiMLApplication };
