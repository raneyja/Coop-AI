import { NextResponse } from "next/server";
import { serverApiBase } from "@/lib/serverCoopApi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const org = url.searchParams.get("org")?.trim() ?? "";
  if (!org) {
    return NextResponse.json(
      { error: "missing_org", message: "Organization name is required." },
      { status: 400 }
    );
  }

  const adminOrigin = url.origin.replace(/\/$/, "");
  const finalRedirect = `${adminOrigin}/auth/callback`;

  const backendUrl = new URL(`${serverApiBase()}/v1/auth/saml/start`);
  backendUrl.searchParams.set("org", org);
  backendUrl.searchParams.set("redirect", finalRedirect);

  const backendResponse = await fetch(backendUrl.toString(), { redirect: "manual", cache: "no-store" });
  const location = backendResponse.headers.get("location");
  if (location) {
    return NextResponse.redirect(location);
  }

  // Backend may redirect errors to /login?message=… — follow that for browsers.
  if (backendResponse.status >= 300 && backendResponse.status < 400) {
    const errorLocation = backendResponse.headers.get("location");
    if (errorLocation) {
      return NextResponse.redirect(errorLocation);
    }
  }

  const body = (await backendResponse.json().catch(() => ({}))) as { message?: string; error?: string };
  const message = body.message ?? body.error ?? "SSO sign-in is unavailable.";
  const loginUrl = new URL("/login", adminOrigin);
  loginUrl.searchParams.set("error", body.error ?? "sso_start_failed");
  loginUrl.searchParams.set("message", message);
  return NextResponse.redirect(loginUrl.toString());
}
