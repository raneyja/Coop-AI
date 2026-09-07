import { resolveCoopApiBase } from "./publicCoopApiBase";

export function getCoopApiBase(): string {
  return resolveCoopApiBase();
}

export async function proxyCoopJson(
  path: string,
  init?: RequestInit
): Promise<{ response: Response; data: Record<string, unknown> }> {
  const response = await fetch(`${getCoopApiBase()}${path}`, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, data };
}
