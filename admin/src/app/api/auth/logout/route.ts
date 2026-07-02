import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  readSessionToken,
  serverApiBase
} from "@/lib/serverCoopApi";

export async function POST(request: Request) {
  const token = await readSessionToken();
  let refreshToken = "";
  try {
    const body = (await request.json()) as { refreshToken?: string };
    refreshToken = String(body.refreshToken ?? "").trim();
  } catch {
    // optional body
  }

  if (token) {
    await fetch(`${serverApiBase()}/v1/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store"
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
