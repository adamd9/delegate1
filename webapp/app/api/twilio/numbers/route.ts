import twilioClient from "@/lib/twilio";

export async function GET() {
  if (!twilioClient) {
    // Return empty array instead of error - phone numbers are optional
    return Response.json([]);
  }

  try {
    const incomingPhoneNumbers = await twilioClient.incomingPhoneNumbers.list({
      limit: 20,
    });
    return Response.json(incomingPhoneNumbers);
  } catch (error: any) {
    // If authentication fails, return empty array - phone numbers are optional
    console.log('Phone number fetch failed (this is OK - phone numbers are optional).');
    console.log('Error details:', {
      status: error?.status,
      code: error?.code,
      message: error?.message,
      moreInfo: error?.moreInfo
    });
    
    // Return empty array so frontend treats it as "no phone numbers configured"
    return Response.json([]);
  }
}

export async function POST(req: Request) {
  if (!twilioClient) {
    return Response.json(
      { error: "Twilio client not initialized" },
      { status: 500 }
    );
  }

  const { phoneNumberSid, voiceUrl } = await req.json();
  const incomingPhoneNumber = await twilioClient
    .incomingPhoneNumbers(phoneNumberSid)
    .update({ voiceUrl });

  return Response.json(incomingPhoneNumber);
}
