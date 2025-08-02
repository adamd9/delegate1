#!/usr/bin/env node

/**
 * Twilio API Key Test Script
 * 
 * This script tests if your Twilio API Key credentials are working correctly
 * by making a simple API call to list your account information.
 */

const twilio = require('twilio');

// Import config from generate-token.js
const { config } = require('./generate-token.js');

async function testApiKey() {
  console.log('🔍 Testing Twilio API Key Credentials\n');
  
  try {
    // Create Twilio client using API Key credentials (AU1 region)
    // Try different AU1 configuration approaches
    const client = twilio(config.apiKeySid, config.apiKeySecret, {
      accountSid: config.accountSid
    });
    
    // Set AU1 region after client creation
    client.region = 'au1';
    client.edge = 'sydney';
    
    console.log('📋 Configuration:');
    console.log('   Account SID:', config.accountSid);
    console.log('   API Key SID:', config.apiKeySid);
    console.log('   API Key Secret:', config.apiKeySecret.substring(0, 8) + '...');
    console.log('');
    
    // Test 1: Get account information
    console.log('🧪 Test 1: Fetching account information...');
    const account = await client.api.accounts(config.accountSid).fetch();
    console.log('   ✅ Account fetch successful');
    console.log('   Account Status:', account.status);
    console.log('   Account Type:', account.type);
    console.log('');
    
    // Test 2: List API Keys to verify permissions
    console.log('🧪 Test 2: Listing API Keys...');
    const apiKeys = await client.keys.list({ limit: 5 });
    console.log('   ✅ API Keys list successful');
    console.log('   Found', apiKeys.length, 'API keys');
    
    // Find our specific API key
    const ourKey = apiKeys.find(key => key.sid === config.apiKeySid);
    if (ourKey) {
      console.log('   ✅ Found our API Key:', ourKey.sid);
      console.log('   Friendly Name:', ourKey.friendlyName);
    } else {
      console.log('   ⚠️  Our API Key not found in list (might be permissions issue)');
    }
    console.log('');
    
    // Test 3: Try to access Voice-related resources
    console.log('🧪 Test 3: Testing Voice permissions...');
    try {
      const calls = await client.calls.list({ limit: 1 });
      console.log('   ✅ Voice permissions confirmed - can access calls');
    } catch (voiceError) {
      console.log('   ❌ Voice permissions issue:', voiceError.message);
      console.log('   💡 Your API Key might not have Voice permissions');
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ API Key credentials are working!');
    console.log('💡 If you\'re still getting token errors, the issue might be:');
    console.log('   1. API Key needs Voice permissions in Twilio Console');
    console.log('   2. Account has restrictions on Voice features');
    console.log('   3. Token generation logic needs adjustment');
    
  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.log('❌ API Key test failed:', error.message);
    console.log('\n💡 Common issues:');
    console.log('   1. API Key Secret is incorrect');
    console.log('   2. API Key SID is incorrect');
    console.log('   3. Account SID is incorrect');
    console.log('   4. API Key has been deleted or deactivated');
    console.log('\n🔧 Next steps:');
    console.log('   1. Double-check your credentials in Twilio Console');
    console.log('   2. Make sure you\'re using API Key credentials, not Auth Token');
    console.log('   3. Verify the API Key has the necessary permissions');
  }
}

// Run the test
if (require.main === module) {
  testApiKey();
}

module.exports = { testApiKey };
