#!/usr/bin/env node

/**
 * TwiML Application Inspector for Delegate 1
 * 
 * This script inspects your original TwiML Application configuration
 * to help debug the 31000 General Error.
 */

const twilio = require('twilio');
const { config } = require('./generate-token.js');

async function inspectTwiMLApplication() {
  console.log('🔍 Inspecting TwiML Application Configuration\n');
  
  try {
    // Create Twilio client using API Key credentials (AU1 region)
    const client = twilio(config.apiKeySid, config.apiKeySecret, {
      accountSid: config.accountSid,
      region: 'au1',
      edge: 'sydney'
    });
    
    const appSid = config.twimlAppSid;
    console.log('📋 Inspecting Application:', appSid);
    console.log('');
    
    // Get application details
    const app = await client.applications(appSid).fetch();
    
    console.log('📱 TwiML Application Details:');
    console.log('   SID:', app.sid);
    console.log('   Friendly Name:', app.friendlyName);
    console.log('   Voice URL:', app.voiceUrl);
    console.log('   Voice Method:', app.voiceMethod);
    console.log('   Status Callback:', app.statusCallback || 'None');
    console.log('   Status Callback Method:', app.statusCallbackMethod || 'None');
    console.log('   Created:', app.dateCreated);
    console.log('   Updated:', app.dateUpdated);
    console.log('');
    
    // Test the Voice URL
    console.log('🧪 Testing Voice URL...');
    const voiceUrl = app.voiceUrl;
    
    if (voiceUrl) {
      try {
        const response = await fetch(voiceUrl, {
          method: app.voiceMethod || 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'From=test&To=test&CallSid=test'
        });
        
        console.log('   Status:', response.status, response.statusText);
        
        if (response.ok) {
          const content = await response.text();
          console.log('   Content Type:', response.headers.get('content-type'));
          console.log('   Response Preview:', content.substring(0, 200) + '...');
          console.log('   ✅ Voice URL is responding');
        } else {
          console.log('   ❌ Voice URL returned error status');
          console.log('   This could be causing the 31000 General Error');
        }
        
      } catch (urlError) {
        console.log('   ❌ Failed to reach Voice URL:', urlError.message);
        console.log('   This is likely causing the 31000 General Error');
      }
    } else {
      console.log('   ❌ No Voice URL configured');
    }
    
    console.log('');
    console.log('🔧 Diagnosis:');
    
    if (voiceUrl && voiceUrl.includes('localhost')) {
      console.log('   ⚠️  Voice URL points to localhost');
      console.log('   This will only work if your backend is running locally');
      console.log('   For external calls, you need ngrok or a public URL');
    } else if (voiceUrl && voiceUrl.includes('ngrok')) {
      console.log('   🌐 Voice URL uses ngrok tunnel');
      console.log('   Make sure your ngrok tunnel is active and pointing to your backend');
    } else if (voiceUrl && voiceUrl.includes('demo.twilio.com')) {
      console.log('   🎵 Voice URL points to Twilio demo');
      console.log('   This should work but only plays hold music');
    }
    
    console.log('');
    console.log('💡 Recommendations:');
    console.log('   1. If using localhost, make sure your backend is running on the correct port');
    console.log('   2. If using ngrok, verify the tunnel is active: ngrok http 8081');
    console.log('   3. Test the Voice URL manually to ensure it returns valid TwiML');
    console.log('   4. Check backend logs for any errors when the URL is called');
    
  } catch (error) {
    console.log('❌ Failed to inspect TwiML Application:', error.message);
    console.log('\n💡 This could indicate:');
    console.log('   1. API Key permissions issue');
    console.log('   2. Application SID is incorrect');
    console.log('   3. Network connectivity problems');
  }
}

// Run the inspection
if (require.main === module) {
  inspectTwiMLApplication();
}

module.exports = { inspectTwiMLApplication };
