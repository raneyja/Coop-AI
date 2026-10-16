import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  fetchMe,
  isCoopCredential,
  readSessionToken,
  setSessionCookie
} from "@/lib/serverCoopApi";
import { publicSessionProfile } from "@/lib/publicSessionProfile";
import { isSameOriginMutation } from "@/lib/portalProxyPolicy";

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    const response = NextResponse.json({ error: "unauthorized", message: "Not signed in." }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }

  const me = await fetchMe(token);
  if (!me.ok) {
    const response = NextResponse.json(me.data, { status: me.status });
    if (me.status === 401) {
      clearSessionCookie(response);
    }
    return response;
  }

  return NextResponse.json(publicSessionProfile(me.data));
}

/** Establish httpOnly session cookie after OAuth / SSO callback. */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { accessToken?: string; refreshToken?: string };
  try {
    body = (await request.json()) as { accessToken?: string; refreshToken?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Invalid JSON body." }, { status: 400 });
  }

  const accessToken = String(body.accessToken ?? "").trim();
  if (!isCoopCredential(accessToken)) {
    return NextResponse.json({ error: "unauthorized", message: "Invalid sign-in token." }, { status: 401 });
  }

  const me = await fetchMe(accessToken);
  if (!me.ok) {
    return NextResponse.json(me.data, { status: me.status });
  }

  const refreshToken = String(body.refreshToken ?? "").trim();
  const response = NextResponse.json(publicSessionProfile(me.data));
  setSessionCookie(response, accessToken, refreshToken);
  return response;
}
