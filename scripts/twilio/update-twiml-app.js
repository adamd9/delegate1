#!/usr/bin/env node

/**
 * TwiML Application Updater for Delegate 1
 * 
 * This script updates the TwiML Application to point to your backend
 * instead of the demo URL, enabling AI conversations.
 */

const twilio = require('twilio');
const { config } = require('./generate-token.js');

async function updateTwiMLApplication() {
  console.log('🔧 Updating TwiML Application for Backend Integration\n');
  
  try {
    // Create Twilio client using API Key credentials (AU1 region)
    const client = twilio(config.apiKeySid, config.apiKeySecret, {
      accountSid: config.accountSid,
      region: 'au1',
      edge: 'sydney'
    });
    
    // Get the TwiML Application SID from config
    const appSid = config.twimlAppSid;
    if (!appSid) {
      console.log('❌ No TwiML Application SID found in config');
      console.log('💡 Run: node create-twiml-app.js first');
      return;
    }
    
    console.log('📋 Current Configuration:');
    console.log('   Application SID:', appSid);
    console.log('');
    
    // Get current application details
    console.log('🔍 Fetching current application details...');
    const currentApp = await client.applications(appSid).fetch();
    
    console.log('📋 Current Application:');
    console.log('   Friendly Name:', currentApp.friendlyName);
    console.log('   Current Voice URL:', currentApp.voiceUrl);
    console.log('');
    
    // Prompt for backend URL
    console.log('🌐 Backend URL Options:');
    console.log('   1. Local development: http://localhost:8081/twiml');
    console.log('   2. ngrok tunnel: https://your-ngrok-url.ngrok.io/twiml');
    console.log('   3. Keep demo URL: http://demo.twilio.com/docs/voice.xml');
    console.log('');
    
    // Use the ngrok URL from backend .env file
    const newVoiceUrl = 'https://4b3acaa7040f.ngrok-free.app/twiml';
    
    console.log('🔄 Updating TwiML Application...');
    console.log('   New Voice URL:', newVoiceUrl);
    
    const updatedApp = await client.applications(appSid).update({
      voiceUrl: newVoiceUrl,
      voiceMethod: 'POST'
    });
    
    console.log('✅ TwiML Application updated successfully!');
    console.log('');
    console.log('📋 Updated Application:');
    console.log('   Application SID:', updatedApp.sid);
    console.log('   Voice URL:', updatedApp.voiceUrl);
    console.log('   Voice Method:', updatedApp.voiceMethod);
    console.log('');
    
    console.log('🎯 Next Steps:');
    console.log('   1. Make sure your backend is running: npm run backend:dev');
    console.log('   2. Ensure your backend has a /twiml endpoint');
    console.log('   3. For production, use ngrok to expose your backend:');
    console.log('      - Install ngrok: brew install ngrok');
    console.log('      - Expose backend: ngrok http 8081');
    console.log('      - Update this script with your ngrok URL');
    console.log('   4. Test voice calls - they should now connect to your backend!');
    console.log('');
    
    console.log('💡 Note: If using localhost, calls will only work from your development machine.');
    console.log('   For external calls, you\'ll need ngrok or a public URL.');
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 TwiML Application updated for backend integration!');
    
  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.log('❌ Failed to update TwiML Application:', error.message);
    console.log('\n💡 Possible issues:');
    console.log('   1. API Key doesn\'t have permissions to update applications');
    console.log('   2. Application SID is incorrect');
    console.log('   3. Network connectivity issues');
    console.log('\n🔧 Manual alternative:');
    console.log('   1. Go to Twilio Console → Voice → TwiML → Applications');
    console.log('   2. Click on "Delegate 1 Voice Client"');
    console.log('   3. Update Voice URL to: http://localhost:8081/twiml');
    console.log('   4. Save the changes');
  }
}

// Run the update
if (require.main === module) {
  updateTwiMLApplication();
}

module.exports = { updateTwiMLApplication };
