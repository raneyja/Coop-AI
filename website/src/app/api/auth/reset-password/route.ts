import { NextResponse } from "next/server";
import { proxyCoopJson } from "@/lib/coopApiProxy";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { response, data } = await proxyCoopJson("/v1/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        error: data.message ?? data.error ?? "Could not reset password",
        code: data.error
      },
      { status: response.status || 502 }
    );
  }

  return NextResponse.json(data);
}
