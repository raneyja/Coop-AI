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

  const mode = url.searchParams.get("mode")?.trim() === "test" ? "test" : "login";
  const adminOrigin = url.origin.replace(/\/$/, "");
  const finalRedirect =
    mode === "test"
      ? `${adminOrigin}/settings/single-sign-on`
      : `${adminOrigin}/auth/callback`;

  const backendUrl = new URL(`${serverApiBase()}/v1/auth/saml/start`);
  backendUrl.searchParams.set("org", org);
  backendUrl.searchParams.set("redirect", finalRedirect);
  if (mode === "test") {
    backendUrl.searchParams.set("mode", "test");
  }

  const backendResponse = await fetch(backendUrl.toString(), { redirect: "manual", cache: "no-store" });
  const location = backendResponse.headers.get("location");
  if (location) {
    return NextResponse.redirect(location);
  }

  // Backend may redirect errors — follow that for browsers.
  if (backendResponse.status >= 300 && backendResponse.status < 400) {
    const errorLocation = backendResponse.headers.get("location");
    if (errorLocation) {
      return NextResponse.redirect(errorLocation);
    }
  }

  const body = (await backendResponse.json().catch(() => ({}))) as { message?: string; error?: string };
  const message = body.message ?? body.error ?? "SSO sign-in is unavailable.";

  if (mode === "test") {
    const settingsUrl = new URL("/settings/single-sign-on", adminOrigin);
    settingsUrl.searchParams.set("sso_test", "failed");
    settingsUrl.searchParams.set("error", body.error ?? "sso_start_failed");
    settingsUrl.searchParams.set("message", message);
    return NextResponse.redirect(settingsUrl.toString());
  }

  const loginUrl = new URL("/login", adminOrigin);
  loginUrl.searchParams.set("error", body.error ?? "sso_start_failed");
  loginUrl.searchParams.set("message", message);
  return NextResponse.redirect(loginUrl.toString());
}
