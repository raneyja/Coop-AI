const MAX_PATH_SEGMENTS = 12;
const MAX_SEGMENT_LENGTH = 256;

/** Only portal-owned backend APIs may be reached through the cookie-authenticated proxy. */
export function portalBackendPath(segments: string[]): string | null {
  if (
    segments.length < 2 ||
    segments.length > MAX_PATH_SEGMENTS ||
    segments[0] !== "v1" ||
    segments.some((segment) =>
      !segment ||
      segment.length > MAX_SEGMENT_LENGTH ||
      segment === "." ||
      segment === ".." ||
      /[%/\\\u0000-\u001f\u007f]/.test(segment)
    )
  ) {
    return null;
  }

  const area = segments[1];
  const portalAreas = new Set(["admin", "me", "threads", "sso", "billing", "collections"]);
  const isInstallationRead = area === "orgs" && segments.length === 4 && segments[3] === "installation";
  const isSamlMetadata = area === "auth" && segments.length === 4 && segments[2] === "saml" && segments[3] === "metadata";
  if (!portalAreas.has(area) && !isInstallationRead && !isSamlMetadata) {
    return null;
  }

  return `/${segments.map(encodeURIComponent).join("/")}`;
}

/** Same-origin fetches use a custom header; cross-origin forms and navigations cannot supply it. */
export function isPortalRequest(request: Request): boolean {
  if (request.headers.get("x-coop-admin-request") !== "1") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== requestHostOrigin(request)) return false;
  if (request.method !== "GET" && request.method !== "HEAD" && !origin) return false;
  return true;
}

/** Cookie-changing auth endpoints accept only browser requests from this portal origin. */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return Boolean(origin) && origin === requestHostOrigin(request) && (!fetchSite || fetchSite === "same-origin");
}

function requestHostOrigin(request: Request): string | null {
  const url = new URL(request.url);
  const host = request.headers.get("host")?.trim() || url.host;
  if (!host || /[\s/@\\]/.test(host)) return null;
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = loopback ? "http:" : process.env.NODE_ENV === "production" ? "https:" : url.protocol;
  try {
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return null;
  }
}
