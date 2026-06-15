import { NextResponse } from "next/server";

function apiBase(): string {
  const base =
    process.env.COOP_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_COOP_API_BASE?.trim() ||
    "https://api.coop-ai.dev";
  return base.replace(/\/$/, "");
}

export async function POST(request: Request) {
  let body: { apiKey?: string };
  try {
    body = (await request.json()) as { apiKey?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = String(body.apiKey ?? "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (!apiKey.startsWith("coop_")) {
    return NextResponse.json({ error: "unauthorized", message: "Invalid API key format." }, { status: 401 });
  }

  const response = await fetch(`${apiBase()}/v1/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store"
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}
