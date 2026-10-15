import { readSessionToken, serverApiBase } from "@/lib/serverCoopApi";
import { isPortalRequest, portalBackendPath } from "@/lib/portalProxyPolicy";

const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

type RouteContext = { params: Promise<{ path: string[] }> };

async function boundedBody(request: Request): Promise<ArrayBuffer | null> {
  if (request.method === "GET") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    reader.releaseLock();
  }
}

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  if (!METHODS.has(request.method)) {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!isPortalRequest(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const path = portalBackendPath((await context.params).path);
  if (!path) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const token = await readSessionToken();
  if (!token) {
    return Response.json({ error: "unauthorized", message: "Not signed in." }, { status: 401 });
  }

  let body: ArrayBuffer | null;
  try {
    body = await boundedBody(request);
  } catch {
    return Response.json({ error: "body_too_large" }, { status: 413 });
  }

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const query = new URL(request.url).search;
  try {
    const upstream = await fetch(`${serverApiBase()}${path}${query}`, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store"
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return Response.json({ error: "unexpected_redirect" }, { status: 502 });
    }
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    const upstreamType = upstream.headers.get("content-type");
    if (upstreamType) responseHeaders.set("Content-Type", upstreamType);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: "backend_unavailable" }, { status: 503 });
  }
}

export async function GET(request: Request, context: RouteContext) { return proxy(request, context); }
export async function POST(request: Request, context: RouteContext) { return proxy(request, context); }
export async function PUT(request: Request, context: RouteContext) { return proxy(request, context); }
export async function PATCH(request: Request, context: RouteContext) { return proxy(request, context); }
export async function DELETE(request: Request, context: RouteContext) { return proxy(request, context); }
