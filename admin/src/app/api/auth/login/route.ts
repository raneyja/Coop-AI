import { NextResponse } from "next/server";
import { fetchMe, serverApiBase, setSessionCookie } from "@/lib/serverCoopApi";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json(
      { error: "invalid_credentials", message: "Enter your email and password." },
      { status: 400 }
    );
  }

  const loginResponse = await fetch(`${serverApiBase()}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store"
  });

  const loginData = (await loginResponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!loginResponse.ok) {
    return NextResponse.json(loginData, { status: loginResponse.status });
  }

  const accessToken = String(loginData.accessToken ?? "").trim();
  const refreshToken = String(loginData.refreshToken ?? "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "incomplete_response", message: "Sign-in response was incomplete." }, { status: 502 });
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
