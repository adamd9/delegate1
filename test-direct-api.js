#!/usr/bin/env node

/**
 * Direct Twilio API Test
 * 
 * This script tests Twilio credentials using direct HTTP requests
 * to help debug authentication issues with AU1 region.
 */

const https = require('https');
const { config } = require('./generate-token.js');

function makeDirectApiCall() {
  console.log('🔍 Testing Direct Twilio API Call (AU1 Region)\n');
  
  // AU1 region endpoints
  const endpoints = [
    'api.au1.twilio.com',
    'accounts.au1.twilio.com', 
    'api.twilio.com'  // fallback to default
  ];
  
  console.log('📋 Configuration:');
  console.log('   Account SID:', config.accountSid);
  console.log('   API Key SID:', config.apiKeySid);
  console.log('   API Key Secret:', config.apiKeySecret.substring(0, 8) + '...');
  console.log('');
  
  // Test each endpoint
  endpoints.forEach((endpoint, index) => {
    console.log(`🧪 Test ${index + 1}: Testing ${endpoint}...`);
    
    const auth = Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString('base64');
    
    const options = {
      hostname: endpoint,
      port: 443,
      path: `/2010-04-01/Accounts/${config.accountSid}.json`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'User-Agent': 'Delegate1-Test/1.0'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`   Status: ${res.statusCode} ${res.statusMessage}`);
        
        if (res.statusCode === 200) {
          console.log('   ✅ Success! API Key works with', endpoint);
          try {
            const account = JSON.parse(data);
            console.log('   Account Status:', account.status);
            console.log('   Account Type:', account.type);
          } catch (e) {
            console.log('   Response data:', data.substring(0, 100) + '...');
          }
        } else if (res.statusCode === 401) {
          console.log('   ❌ Authentication failed');
          console.log('   Response:', data);
        } else {
          console.log('   ⚠️  Unexpected response:', data.substring(0, 200));
        }
        console.log('');
      });
    });
    
    req.on('error', (e) => {
      console.log(`   ❌ Request failed: ${e.message}`);
      console.log('');
    });
    
    req.setTimeout(5000, () => {
      console.log('   ⏰ Request timeout');
      req.destroy();
      console.log('');
    });
    
    req.end();
  });
}

// Also test if we can create a basic access token without API calls
function testTokenGeneration() {
  console.log('🔧 Testing Token Generation Logic...\n');
  
  try {
    const twilio = require('twilio');
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;
    
    // Create Voice Grant
    const voiceGrant = new VoiceGrant({
      incomingAllow: true
    });
    
    // Create access token (this doesn't make API calls)
    const token = new AccessToken(
      config.accountSid,
      config.apiKeySid,
      config.apiKeySecret,
      { identity: 'test-user' }
    );
    
    token.addGrant(voiceGrant);
    const jwt = token.toJwt();
    
    console.log('✅ Token generation successful');
    console.log('🔍 Token length:', jwt.length);
    console.log('🔍 Token preview:', jwt.substring(0, 50) + '...');
    console.log('');
    
    // Decode and inspect the token
    const parts = jwt.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    console.log('📋 Token payload:');
    console.log('   Issuer (API Key):', payload.iss);
    console.log('   Subject (Account):', payload.sub);
    console.log('   Identity:', payload.grants?.identity);
    console.log('   Voice Grant:', payload.grants?.voice ? '✅ Present' : '❌ Missing');
    console.log('');
    
    return jwt;
    
  } catch (error) {
    console.log('❌ Token generation failed:', error.message);
    console.log('');
    return null;
  }
}

// Run tests
if (require.main === module) {
  const token = testTokenGeneration();
  
  setTimeout(() => {
    makeDirectApiCall();
  }, 1000);
}

module.exports = { testTokenGeneration, makeDirectApiCall };
