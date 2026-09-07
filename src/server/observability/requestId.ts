import { createRequestId } from "../../api/ModelRouter";

/** Incoming ids we will echo; reject junk so clients cannot flood tags. */
const SAFE_REQUEST_ID = /^[\w.:-]{8,128}$/;

export function resolveHttpRequestId(
  headers: Record<string, string | undefined> | undefined
): string {
  const incoming = headers?.["x-request-id"]?.trim();
  if (incoming && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return createRequestId();
}
