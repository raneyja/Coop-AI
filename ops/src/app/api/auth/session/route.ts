import { NextResponse } from "next/server";
import {
  fetchOperatorMe,
  isCoopCredential,
  readSessionToken,
  setSessionCookie
} from "@/lib/serverCoopApi";

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized", message: "Not signed in." }, { status: 401 });
  }

  const me = await fetchOperatorMe(token);
  if (!me.ok) {
    const response = NextResponse.json(me.data, { status: me.status });
    if (me.status === 401) {
      response.cookies.set("coop_ops_session", "", { httpOnly: true, path: "/", maxAge: 0 });
    }
    return response;
  }

  return NextResponse.json({
    ...me.data,
    accessToken: token
  });
}

export async function POST(request: Request) {
  let body: { accessToken?: string };
  try {
    body = (await request.json()) as { accessToken?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Invalid JSON body." }, { status: 400 });
  }

  const accessToken = String(body.accessToken ?? "").trim();
  if (!isCoopCredential(accessToken)) {
    return NextResponse.json({ error: "unauthorized", message: "Invalid sign-in token." }, { status: 401 });
  }

  const me = await fetchOperatorMe(accessToken);
  if (!me.ok) {
    return NextResponse.json(me.data, { status: me.status });
  }

  const response = NextResponse.json({
    ...me.data,
    accessToken
  });
  setSessionCookie(response, accessToken);
  return response;
}
