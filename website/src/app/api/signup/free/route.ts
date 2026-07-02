import { NextResponse } from "next/server";
import { proxyCoopJson } from "@/lib/coopApiProxy";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; orgName?: string; displayName?: string };
  try {
    body = (await request.json()) as {
      email?: string;
      password?: string;
      orgName?: string;
      displayName?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const orgName = String(body.orgName ?? body.displayName ?? "").trim();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }

  const { response, data } = await proxyCoopJson("/v1/signup/free", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, orgName: orgName || undefined })
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        error: data.message ?? data.error ?? "Signup unavailable",
        code: data.code ?? data.error
      },
      { status: response.status || 502 }
    );
  }

  return NextResponse.json(data, { status: response.status });
}
