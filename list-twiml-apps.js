#!/usr/bin/env node

/**
 * TwiML Application Lister for Delegate 1
 * 
 * This script lists all TwiML Applications in your account to help
 * identify the original one that was configured with your backend.
 */

const twilio = require('twilio');
const { config } = require('./generate-token.js');

async function listTwiMLApplications() {
  console.log('🔍 Finding Your TwiML Applications\n');
  
  try {
    // Create Twilio client using API Key credentials (AU1 region)
    const client = twilio(config.apiKeySid, config.apiKeySecret, {
      accountSid: config.accountSid,
      region: 'au1',
      edge: 'sydney'
    });
    
    console.log('📋 Account:', config.accountSid);
    console.log('');
    
    // List all TwiML Applications
    console.log('🔍 Fetching TwiML Applications...');
    const applications = await client.applications.list();
    
    if (applications.length === 0) {
      console.log('❌ No TwiML Applications found in your account');
      return;
    }
    
    console.log(`✅ Found ${applications.length} TwiML Application(s):\n`);
    
    applications.forEach((app, index) => {
      console.log(`📱 Application ${index + 1}:`);
      console.log(`   SID: ${app.sid}`);
      console.log(`   Name: ${app.friendlyName}`);
      console.log(`   Voice URL: ${app.voiceUrl}`);
      console.log(`   Voice Method: ${app.voiceMethod}`);
      console.log(`   Status Callback: ${app.statusCallback || 'None'}`);
      console.log(`   Created: ${app.dateCreated}`);
      console.log('');
      
      // Highlight the one we just created vs original
      if (app.friendlyName === 'Delegate 1 Voice Client') {
        console.log('   👆 This is the NEW app we just created (with demo URL)');
      } else {
        console.log('   👆 This might be your ORIGINAL app (check the Voice URL)');
      }
      console.log('');
    });
    
    console.log('🎯 Next Steps:');
    console.log('   1. Identify which app has your backend URL configured');
    console.log('   2. Copy that Application SID');
    console.log('   3. Update generate-token.js with the correct SID');
    console.log('   4. Generate a new token: node generate-token.js');
    console.log('   5. Test voice calls - they should connect to your backend!');
    console.log('');
    
    // Show current config
    console.log('📋 Current Configuration:');
    console.log(`   Using App SID: ${config.twimlAppSid}`);
    console.log('   To change: Edit the twimlAppSid in generate-token.js');
    
  } catch (error) {
    console.log('❌ Failed to list TwiML Applications:', error.message);
    console.log('\n💡 Possible issues:');
    console.log('   1. API Key doesn\'t have permissions to list applications');
    console.log('   2. Network connectivity issues');
    console.log('\n🔧 Manual alternative:');
    console.log('   1. Go to Twilio Console → Voice → TwiML → Applications');
    console.log('   2. Find your original application');
    console.log('   3. Copy the Application SID');
    console.log('   4. Update generate-token.js manually');
  }
}

// Run the listing
if (require.main === module) {
  listTwiMLApplications();
}

module.exports = { listTwiMLApplications };
