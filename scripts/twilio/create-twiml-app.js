#!/usr/bin/env node

/**
 * TwiML Application Creator for Delegate 1
 * 
 * This script creates a TwiML Application in your Twilio account to enable
 * outgoing calls from the voice client.
 */

const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

// Import config from generate-token.js
const { config } = require('./generate-token.js');

async function createTwiMLApplication() {
  console.log('🔧 Creating TwiML Application for Outgoing Calls\n');
  
  try {
    // Create Twilio client using API Key credentials (AU1 region)
    const client = twilio(config.apiKeySid, config.apiKeySecret, {
      accountSid: config.accountSid,
      region: 'au1',
      edge: 'sydney'
    });
    
    console.log('📋 Configuration:');
    console.log('   Account SID:', config.accountSid);
    console.log('   API Key SID:', config.apiKeySid);
    console.log('');
    
    // Create TwiML Application
    console.log('🏗️  Creating TwiML Application...');
    
    const application = await client.applications.create({
      friendlyName: 'Delegate 1 Voice Client',
      voiceUrl: 'http://demo.twilio.com/docs/voice.xml', // Default TwiML for testing
      voiceMethod: 'POST',
      statusCallback: '', // Optional: Add your webhook URL here later
      statusCallbackMethod: 'POST'
    });
    
    console.log('✅ TwiML Application created successfully!');
    console.log('');
    console.log('📋 Application Details:');
    console.log('   Application SID:', application.sid);
    console.log('   Friendly Name:', application.friendlyName);
    console.log('   Voice URL:', application.voiceUrl);
    console.log('');
    
    // Update generate-token.js with the new Application SID
    console.log('🔄 Updating generate-token.js with Application SID...');
    
    const generateTokenPath = path.join(__dirname, 'generate-token.js');
    let content = fs.readFileSync(generateTokenPath, 'utf8');
    
    // Replace the empty twimlAppSid with the new Application SID
    content = content.replace(
      /twimlAppSid: '',/,
      `twimlAppSid: '${application.sid}',`
    );
    
    fs.writeFileSync(generateTokenPath, content);
    
    console.log('✅ Updated generate-token.js with new Application SID');
    console.log('');
    
    // Generate a new token with outgoing call support
    console.log('🔑 Generating new access token with outgoing call support...');
    
    const { execSync } = require('child_process');
    try {
      const tokenOutput = execSync('node generate-token.js', { encoding: 'utf8' });
      console.log('✅ New token generated successfully!');
      console.log('');
      console.log('🎯 Next Steps:');
      console.log('   1. The new token has been generated and should be in voice-client/.env');
      console.log('   2. Restart your voice client: npm run voice-client:dev');
      console.log('   3. Try making an outgoing call - it should work now!');
      console.log('');
      console.log('💡 Note: The TwiML Application uses a demo voice URL for testing.');
      console.log('   Later, you can update the Voice URL to point to your backend.');
      
    } catch (tokenError) {
      console.log('⚠️  Token generation failed, but you can run it manually:');
      console.log('   node generate-token.js');
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 TwiML Application setup complete!');
    console.log('   Application SID:', application.sid);
    console.log('   Your voice client can now make outgoing calls.');
    
  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.log('❌ Failed to create TwiML Application:', error.message);
    console.log('\n💡 Possible issues:');
    console.log('   1. API Key doesn\'t have permissions to create applications');
    console.log('   2. Account has restrictions on creating applications');
    console.log('   3. Network connectivity issues');
    console.log('\n🔧 Manual alternative:');
    console.log('   1. Go to Twilio Console → Voice → TwiML → Applications');
    console.log('   2. Create a new Application with:');
    console.log('      - Friendly Name: "Delegate 1 Voice Client"');
    console.log('      - Voice URL: "http://demo.twilio.com/docs/voice.xml"');
    console.log('   3. Copy the Application SID to generate-token.js');
    console.log('   4. Run: node generate-token.js');
  }
}

// Run the setup
if (require.main === module) {
  createTwiMLApplication();
}

module.exports = { createTwiMLApplication };
