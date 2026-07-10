import { NextResponse } from "next/server";
import { clearSessionCookie, readSessionToken, serverApiBase } from "@/lib/serverCoopApi";

export async function POST() {
  const token = await readSessionToken();

  if (token) {
    await fetch(`${serverApiBase()}/v1/operator/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: "{}",
      cache: "no-store"
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
