import { NextResponse } from "next/server";
import { fetchMe, serverApiBase, setSessionCookie } from "@/lib/serverCoopApi";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; orgName?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string; orgName?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const orgName = String(body.orgName ?? "").trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "invalid_credentials", message: "Enter your email and password." },
      { status: 400 }
    );
  }

  const registerResponse = await fetch(`${serverApiBase()}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, orgName: orgName || undefined }),
    cache: "no-store"
  });

  const registerData = (await registerResponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!registerResponse.ok) {
    return NextResponse.json(registerData, { status: registerResponse.status });
  }

  const accessToken = String(registerData.accessToken ?? "").trim();
  const refreshToken = String(registerData.refreshToken ?? "").trim();
  if (!accessToken) {
    return NextResponse.json(
      { error: "incomplete_response", message: "Signup response was incomplete." },
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

  const response = NextResponse.json(payload, { status: 201 });
  setSessionCookie(response, accessToken);
  return response;
}
