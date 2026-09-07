import { NextResponse } from "next/server";
import { backendGoogleStartUrl } from "@/lib/googleAuthStart";
import { resolveCoopApiBase } from "@/lib/publicCoopApiBase";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const backendUrl = backendGoogleStartUrl(resolveCoopApiBase(), incoming.searchParams);

  if (
    (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") &&
    /localhost|127\.0\.0\.1/i.test(backendUrl)
  ) {
    return NextResponse.json(
      {
        error: "google_auth_unavailable",
        message: "Google sign-up is not configured for this environment."
      },
      { status: 503 }
    );
  }

  const backendResponse = await fetch(backendUrl, { redirect: "manual", cache: "no-store" });
  const location = backendResponse.headers.get("location");
  if (location) {
    return NextResponse.redirect(location);
  }

  const body = (await backendResponse.json().catch(() => ({}))) as { message?: string; error?: string };
  return NextResponse.json(
    {
      error: body.error ?? "google_auth_unavailable",
      message: body.message ?? "Google sign-in is unavailable."
    },
    { status: backendResponse.status || 503 }
  );
}
