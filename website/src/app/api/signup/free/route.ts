import { NextResponse } from "next/server";

const API_BASE = process.env.COOP_API_BASE?.trim() || "http://localhost:8787";

export async function POST(request: Request) {
  let body: { email?: string; orgName?: string; displayName?: string };
  try {
    body = (await request.json()) as { email?: string; orgName?: string; displayName?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const orgName = String(body.orgName ?? body.displayName ?? "").trim();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const response = await fetch(`${API_BASE}/v1/signup/free`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, orgName: orgName || undefined })
  });

  const data = (await response.json().catch(() => ({}))) as {
    apiKey?: string;
    adminPortalLoginUrl?: string;
    error?: string;
    code?: string;
    message?: string;
  };

  if (!response.ok) {
    return NextResponse.json(
      {
        error: data.message ?? data.error ?? "Signup unavailable",
        code: data.code
      },
      { status: response.status || 502 }
    );
  }

  return NextResponse.json(data);
}
