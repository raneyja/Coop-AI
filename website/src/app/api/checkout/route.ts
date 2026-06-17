import { NextResponse } from "next/server";

const API_BASE = process.env.COOP_API_BASE?.trim() || "http://localhost:8787";

export async function POST(request: Request) {
  let body: { orgName?: string; email?: string; seats?: number };
  try {
    body = (await request.json()) as { orgName?: string; email?: string; seats?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgName = String(body.orgName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const seats = Math.max(1, Number(body.seats ?? 1) || 1);

  if (!orgName || !email) {
    return NextResponse.json({ error: "orgName and email are required" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const response = await fetch(`${API_BASE}/v1/billing/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName, email, seats })
  });

  const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
  if (!response.ok || !data.url) {
    return NextResponse.json(
      { error: data.message ?? data.error ?? "Checkout unavailable" },
      { status: response.status || 502 }
    );
  }

  return NextResponse.json({ url: data.url });
}
