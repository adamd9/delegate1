import { NextResponse } from "next/server";
import { getBackendUrl } from "@/lib/get-backend-url";

export async function POST(req: Request) {
  const backendUrl = getBackendUrl();
  const url = `${backendUrl.replace(/\/$/, "")}/deepgram/token`;

  let bodyText: string | undefined;
  try {
    bodyText = await req.text();
  } catch {
    bodyText = undefined;
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": req.headers.get("content-type") || "application/json",
      },
      body: bodyText,
      cache: "no-store",
    });

    const text = await resp.text();

    return new NextResponse(text, {
      status: resp.status,
      headers: {
        "content-type": resp.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    const msg = `Failed to fetch Deepgram token from ${url}: ${err?.message || err}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
