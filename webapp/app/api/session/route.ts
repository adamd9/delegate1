export async function GET() {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2025-06-03",
        voice: "verse",
      }),
    });

    if (!r.ok) {
      const error = await r.text();
      return Response.json({ error }, { status: 500 });
    }

    const data = await r.json();
    return Response.json(data);
  } catch (error) {
    console.error("Error creating realtime session:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
