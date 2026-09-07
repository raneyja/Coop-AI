/**
 * POST JSON to a Google Apps Script web app.
 *
 * GAS runs doPost on the first /exec request, then 302s to a
 * script.googleusercontent.com echo URL. That echo URL is GET-only —
 * POSTing it returns 405 HTML and we never see `{ ok: true }`.
 */
export async function postToGoogleAppsScript(
  webAppUrl: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status: number; text: string; parsed?: { ok?: boolean; error?: string; lastRow?: number } }> {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };

  let response = await fetchImpl(webAppUrl, {
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
    const redirectUrl = new URL(location, webAppUrl).toString();
    response = await fetchImpl(redirectUrl, {
      method: "GET",
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
