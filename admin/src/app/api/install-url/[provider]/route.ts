import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/serverCoopApi";

const ALLOWED = new Set([
  "github",
  "gitlab",
  "bitbucket",
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const { provider } = await context.params;
  if (!ALLOWED.has(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }

  const query = new URL(request.url).searchParams.toString();
  const path = query
    ? `/v1/${provider}/app/install-url?${query}`
    : `/v1/${provider}/app/install-url`;
  const response = await backendFetch(path, request);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}
