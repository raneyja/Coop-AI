export function getCoopApiBase(): string {
  return (process.env.COOP_API_BASE?.trim() || "http://localhost:8787").replace(/\/$/, "");
}

export async function proxyCoopJson(
  path: string,
  init?: RequestInit
): Promise<{ response: Response; data: Record<string, unknown> }> {
  const response = await fetch(`${getCoopApiBase()}${path}`, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, data };
}
