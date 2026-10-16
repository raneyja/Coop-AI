/** Hang ceiling for vendor HTTP (Notion, Slack, Jira, …). Not a Talk-track timer. */
export const INTEGRATION_HTTP_TIMEOUT_MS = 15_000;

/** Opened page/ticket/thread body shown to Interpret / Talk track. */
export const OPENED_ARTIFACT_BODY_CHARS = 8_000;

/** Ceiling on parallel Opens — a max, not “always Open the first three rows.” */
export const MAX_VENDOR_OPENS = 3;

export function integrationAuthFailureMessage(status: number): string | undefined {
  if (status === 401 || status === 403) {
    return "Couldn't sign in to that tool.";
  }
  return undefined;
}

/** Read the whole vendor response under one deadline and byte ceiling, including slow bodies. */
export async function fetchIntegrationResponse(
  url: string, init: RequestInit = {}, timeoutMs = INTEGRATION_HTTP_TIMEOUT_MS
): Promise<Response | import("../networkResilience").TimeoutResult> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  init.signal?.addEventListener("abort", forward, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = setTimeout(forward, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abortRead: (() => void) | undefined;
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: "error" });
    if (!response.body) return response;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const stopped = new Promise<never>((_, reject) => {
      abortRead = () => { void reader?.cancel().catch(() => undefined); reject(new Error("Integration transport stopped.")); };
      controller.signal.addEventListener("abort", abortRead, { once: true });
      if (controller.signal.aborted) abortRead();
    });
    while (true) {
      const next = await Promise.race([reader.read(), stopped]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); throw new Error("Integration response exceeds the byte limit."); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    if (controller.signal.aborted) return { timeout: true, message: init.signal?.aborted ? "Stopped." : "Integration request timed out." };
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", forward);
    if (abortRead) controller.signal.removeEventListener("abort", abortRead);
    reader?.releaseLock();
  }
}
