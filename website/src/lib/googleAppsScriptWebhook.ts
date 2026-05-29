/**
 * POST to a Google Apps Script web app URL.
 * GAS responds with 302; default fetch may turn the follow-up into GET and skip doPost.
 */
export async function postToGoogleAppsScript(
  webAppUrl: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; status: number; text: string; parsed?: { ok?: boolean; error?: string; lastRow?: number } }> {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };

  let response = await fetch(webAppUrl, {
    method: "POST",
    headers,
    body,
    redirect: "manual"
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      return { ok: false, status: response.status, text: "Redirect without Location header" };
    }
    response = await fetch(location, {
      method: "POST",
      headers,
      body,
      redirect: "follow"
    });
  }

  const text = await response.text();
  let parsed: { ok?: boolean; error?: string; lastRow?: number } | undefined;
  try {
    parsed = JSON.parse(text) as { ok?: boolean; error?: string; lastRow?: number };
  } catch {
    parsed = undefined;
  }

  const ok = response.ok && parsed?.ok === true;
  return { ok, status: response.status, text, parsed };
}
