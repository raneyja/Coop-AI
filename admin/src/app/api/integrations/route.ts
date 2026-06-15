import { NextResponse } from "next/server";

function apiBase(): string {
  const base =
    process.env.COOP_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_COOP_API_BASE?.trim() ||
    "https://api.coop-ai.dev";
  return base.replace(/\/$/, "");
}

export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer coop_")) {
    return NextResponse.json({ error: "unauthorized", message: "Not signed in." }, { status: 401 });
  }

  const response = await fetch(`${apiBase()}/v1/admin/integrations`, {
    headers: { Authorization: authorization },
    cache: "no-store"
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}
