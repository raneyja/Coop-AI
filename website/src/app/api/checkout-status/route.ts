import { NextResponse } from "next/server";
import { resolveCoopApiBase } from "../../../lib/publicCoopApiBase";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ status: "invalid", message: "session_id is required" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(
      `${resolveCoopApiBase()}/v1/billing/checkout-status?session_id=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", message: "Checkout status unavailable" },
      { status: 502 }
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    status?: string;
    orgName?: string;
    adminPortalLoginUrl?: string;
    message?: string;
  };

  return NextResponse.json(data, { status: response.status });
}
