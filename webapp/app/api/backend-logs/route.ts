import { NextResponse } from "next/server";

// Proxy to backend websocket-server /logs to avoid browser CORS and allow server-side fetch
export async function GET() {
  const backendUrl = process.env.WEBSOCKET_SERVER_URL || "http://localhost:8081";
  const url = `${backendUrl.replace(/\/$/, "")}/logs`;
  try {
    const resp = await fetch(url, { cache: "no-store" });
    const text = await resp.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    const msg = `Failed to fetch backend logs from ${url}: ${err?.message || err}`;
    return new NextResponse(msg, { status: 502 });
  }
}
