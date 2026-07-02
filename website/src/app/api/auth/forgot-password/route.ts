import { NextResponse } from "next/server";
import { proxyCoopJson } from "@/lib/coopApiProxy";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { response, data } = await proxyCoopJson("/v1/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return NextResponse.json(data, { status: response.ok ? 200 : response.status || 502 });
}
