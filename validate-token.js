#!/usr/bin/env node

/**
 * Twilio Access Token Validator for Delegate 1
 * 
 * This script validates and inspects Twilio access tokens to help debug issues.
 */

const fs = require('fs');
const path = require('path');

function validateToken(token) {
  if (!token) {
    console.log('❌ No token provided');
    return false;
  }

  try {
    // Parse JWT token
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log('❌ Invalid JWT format - should have 3 parts separated by dots');
      return false;
    }

    // Decode header
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    console.log('📋 Token Header:');
    console.log('   Algorithm:', header.alg);
    console.log('   Type:', header.typ);
    console.log('   Content Type:', header.cty);

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    console.log('\n📋 Token Payload:');
    console.log('   JTI (Token ID):', payload.jti);
    console.log('   Issuer (API Key):', payload.iss);
    console.log('   Subject (Account SID):', payload.sub);
    console.log('   Identity:', payload.grants?.identity);
    
    // Check timing
    const now = Math.floor(Date.now() / 1000);
    const iat = payload.iat;
    const exp = payload.exp;
    
    console.log('\n⏰ Token Timing:');
    console.log('   Issued at:', new Date(iat * 1000).toISOString());
    console.log('   Expires at:', new Date(exp * 1000).toISOString());
    console.log('   Current time:', new Date().toISOString());
    console.log('   Valid for:', Math.max(0, exp - now), 'seconds');
    console.log('   Status:', now > exp ? '❌ EXPIRED' : '✅ VALID');

    // Check grants
    console.log('\n🔐 Token Grants:');
    if (payload.grants?.voice) {
      console.log('   Voice Grant: ✅ Present');
      console.log('   Incoming Allow:', payload.grants.voice.incoming?.allow ? '✅ Yes' : '❌ No');
      if (payload.grants.voice.outgoingApplicationSid) {
        console.log('   Outgoing App SID:', payload.grants.voice.outgoingApplicationSid);
      } else {
        console.log('   Outgoing App SID: ❌ Not set');
      }
    } else {
      console.log('   Voice Grant: ❌ Missing');
    }

    // Validate structure
    console.log('\n🔍 Validation:');
    const issues = [];
    
    if (!payload.sub || !payload.sub.startsWith('AC')) {
      issues.push('Subject (Account SID) should start with "AC"');
    }
    
    if (!payload.iss || !payload.iss.startsWith('SK')) {
      issues.push('Issuer (API Key SID) should start with "SK"');
    }
    
    if (!payload.grants?.identity) {
      issues.push('Identity is missing from grants');
    }
    
    if (!payload.grants?.voice) {
      issues.push('Voice grant is missing');
    }
    
    if (now > exp) {
      issues.push('Token has expired');
    }

    if (issues.length === 0) {
      console.log('   ✅ Token structure looks valid');
      return true;
    } else {
      console.log('   ❌ Issues found:');
      issues.forEach(issue => console.log(`     - ${issue}`));
      return false;
    }

  } catch (error) {
    console.log('❌ Error parsing token:', error.message);
    return false;
  }
}

// Main execution
if (require.main === module) {
  console.log('🔍 Twilio Access Token Validator\n');
  
  // Try to read token from voice-client .env file
  const envPath = path.join(__dirname, 'voice-client', '.env');
  let token = null;
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/VITE_TWILIO_ACCESS_TOKEN=(.+)/);
    if (match) {
      token = match[1].trim();
      console.log('📁 Reading token from voice-client/.env\n');
    }
  }
  
  if (!token) {
    console.log('❌ No token found in voice-client/.env');
    console.log('💡 Make sure you have VITE_TWILIO_ACCESS_TOKEN set in voice-client/.env');
    process.exit(1);
  }
  
  const isValid = validateToken(token);
  
  console.log('\n' + '='.repeat(50));
  console.log(isValid ? '✅ Token validation passed' : '❌ Token validation failed');
  
  if (!isValid) {
    console.log('\n💡 Suggestions:');
    console.log('   1. Generate a new token: node generate-token.js');
    console.log('   2. Check your Twilio credentials in generate-token.js');
    console.log('   3. Make sure your API Key has Voice permissions');
    console.log('   4. Verify your Account SID and API Key are correct');
  }
}

module.exports = { validateToken };
