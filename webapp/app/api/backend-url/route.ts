import { NextResponse } from "next/server";
import { getBackendUrl } from "@/lib/get-backend-url";

export async function GET() {
  const backendUrl = getBackendUrl();
  return NextResponse.json({ backendUrl });
}
