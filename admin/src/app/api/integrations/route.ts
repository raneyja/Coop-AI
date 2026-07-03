import { NextResponse } from "next/server";

function apiBase(): string {
  const base =
    process.env.COOP_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_COOP_API_BASE?.trim() ||
    "https://api.coop-ai.dev";
  return base.replace(/\/$/, "");
}

function isBearerCredential(authorization: string | null | undefined): authorization is string {
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.startsWith("coop_") || token.startsWith("coop_sess_");
}

export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization")?.trim();
  if (!isBearerCredential(authorization)) {
    return NextResponse.json({ error: "unauthorized", message: "Not signed in." }, { status: 401 });
  }

  const refresh = new URL(request.url).searchParams.get("refresh");
  const refreshSuffix = refresh === "true" ? "?refresh=true" : "";

  const response = await fetch(`${apiBase()}/v1/admin/integrations${refreshSuffix}`, {
    headers: { Authorization: authorization },
    cache: "no-store"
  });

  if (response.status === 403) {
    const memberResponse = await fetch(`${apiBase()}/v1/me/integrations`, {
      headers: { Authorization: authorization },
      cache: "no-store"
    });
    const memberData = (await memberResponse.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(memberData, { status: memberResponse.status });
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}
