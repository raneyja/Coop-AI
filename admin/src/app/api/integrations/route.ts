import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/serverCoopApi";

export async function GET(request: Request): Promise<NextResponse> {
  const refresh = new URL(request.url).searchParams.get("refresh");
  const refreshSuffix = refresh === "true" ? "?refresh=true" : "";

  const response = await backendFetch(`/v1/admin/integrations${refreshSuffix}`, request);

  if (response.status === 403) {
    const memberResponse = await backendFetch("/v1/me/integrations", request);
    const memberData = (await memberResponse.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(memberData, { status: memberResponse.status });
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}
