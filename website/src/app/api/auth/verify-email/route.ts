import { NextResponse } from "next/server";
import { proxyCoopJson } from "@/lib/coopApiProxy";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const { response, data } = await proxyCoopJson(
    `/v1/auth/verify-email?token=${encodeURIComponent(token)}`,
    { method: "GET" }
  );

  if (!response.ok) {
    return NextResponse.json(
      {
        error: data.message ?? data.error ?? "Verification failed",
        code: data.error
      },
      { status: response.status || 502 }
    );
  }

  return NextResponse.json(data);
}
