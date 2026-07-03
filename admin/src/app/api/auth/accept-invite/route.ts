import { NextResponse } from "next/server";
import { fetchMe, serverApiBase, setSessionCookie } from "@/lib/serverCoopApi";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json(
      { error: "missing_token", message: "Invitation link is missing or malformed." },
      { status: 400 }
    );
  }

  const previewResponse = await fetch(
    `${serverApiBase()}/v1/auth/accept-invite?token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  const previewData = (await previewResponse.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(previewData, { status: previewResponse.status });
}

export async function POST(request: Request) {
  let body: {
    token?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    timezone?: string;
  };
  try {
    body = (await request.json()) as {
      token?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      timezone?: string;
    };
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Invalid JSON body." }, { status: 400 });
  }

  const token = String(body.token ?? "").trim();
  const password = String(body.password ?? "");
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const timezone = String(body.timezone ?? "").trim();
  if (!token || !password || !firstName || !lastName || !timezone) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Complete your profile and password to accept your invitation."
      },
      { status: 400 }
    );
  }

  const acceptResponse = await fetch(`${serverApiBase()}/v1/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password, firstName, lastName, timezone }),
    cache: "no-store"
  });

  const acceptData = (await acceptResponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!acceptResponse.ok) {
    return NextResponse.json(acceptData, { status: acceptResponse.status });
  }

  const accessToken = String(acceptData.accessToken ?? "").trim();
  const refreshToken = String(acceptData.refreshToken ?? "").trim();
  if (!accessToken) {
    return NextResponse.json(
      { error: "incomplete_response", message: "Invitation acceptance response was incomplete." },
      { status: 502 }
    );
  }

  const me = await fetchMe(accessToken);
  if (!me.ok) {
    return NextResponse.json(me.data, { status: me.status });
  }

  const payload = {
    ...me.data,
    accessToken,
    refreshToken,
    authMethod: "password" as const
  };

  const response = NextResponse.json(payload);
  setSessionCookie(response, accessToken);
  return response;
}
