export async function GET() {
  try {
    const credentialsSet = Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    );
    
    // Ensure we're returning a valid JSON response
    return Response.json({ 
      credentialsSet,
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    console.error('Error in Twilio API route:', error);
    
    // Return a valid error response
    return Response.json({ 
      error: 'Internal server error', 
      credentialsSet: false 
    }, { status: 500 });
  }
}
