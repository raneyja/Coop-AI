import { NextResponse } from "next/server";

const API_BASE = process.env.COOP_API_BASE?.trim() || "http://localhost:8787";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ status: "invalid", message: "session_id is required" }, { status: 400 });
  }

  const response = await fetch(
    `${API_BASE}/v1/billing/checkout-status?session_id=${encodeURIComponent(sessionId)}`,
    { cache: "no-store" }
  );

  const data = (await response.json().catch(() => ({}))) as {
    status?: string;
    orgName?: string;
    adminPortalLoginUrl?: string;
    message?: string;
  };

  return NextResponse.json(data, { status: response.status });
}
