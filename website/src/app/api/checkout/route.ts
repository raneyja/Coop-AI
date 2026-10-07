import { NextResponse } from "next/server";
import { resolveCoopApiBase } from "../../../lib/publicCoopApiBase";

type CheckoutIntent = "individual" | "team";

export async function POST(request: Request) {
  let body: {
    orgName?: string;
    email?: string;
    seats?: number;
    tier?: string;
    intent?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const orgName = String(body.orgName ?? "").trim();
  const seats = Math.max(1, Number(body.seats ?? 1) || 1);
  const intent: CheckoutIntent =
    body.intent === "team" || body.intent === "individual"
      ? body.intent
      : orgName
        ? "team"
        : "individual";
  const tier =
    body.tier === "pro_plus" || body.tier === "max" || body.tier === "pro" ? body.tier : "pro";

  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (intent === "team" && !orgName) {
    return NextResponse.json(
      { error: "Organization name is required when buying seats for a team." },
      { status: 400 }
    );
  }

  let response: Response;
  try {
    response = await fetch(`${resolveCoopApiBase()}/v1/billing/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        tier,
        intent,
        ...(intent === "team" ? { orgName, seats } : {})
      })
    });
  } catch {
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
  }

  const data = (await response.json().catch(() => ({}))) as {
    url?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok || !data.url) {
    return NextResponse.json(
      { error: data.message ?? data.error ?? "Checkout unavailable" },
      { status: response.status || 502 }
    );
  }

  return NextResponse.json({ url: data.url });
}
