import { MAX_VENDOR_OPENS } from "./integrationHttp";

export { MAX_VENDOR_OPENS, OPENED_ARTIFACT_BODY_CHARS, INTEGRATION_HTTP_TIMEOUT_MS } from "./integrationHttp";

function normalizeId(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Open chosen hits in parallel (ceiling 3). Keep the title/url row if Open fails.
 * Selection is by id, not rank — hit 4 can Open; hits 1–3 can be skipped.
 * failClosed returns only reauthorized selected rows and propagates denied or foreign reads.
 */
export async function openHitsByIds<T>(options: {
  hits: T[];
  ids: string[];
  idOf: (hit: T) => string | undefined;
  openOne: (hit: T) => Promise<T>;
  max?: number;
  failClosed?: boolean;
}): Promise<T[]> {
  const cap = options.max ?? MAX_VENDOR_OPENS;
  const wanted: string[] = [];
  const seenWanted = new Set<string>();
  for (const raw of options.ids) {
    const key = normalizeId(raw);
    if (!key || seenWanted.has(key) || wanted.length >= cap) {
      continue;
    }
    seenWanted.add(key);
    wanted.push(key);
  }
  if (wanted.length === 0 || options.hits.length === 0) {
    return options.failClosed ? [] : options.hits;
  }
  const byId = new Map<string, T>();
  for (const hit of options.hits) {
    const key = normalizeId(options.idOf(hit));
    if (key && !byId.has(key)) {
      byId.set(key, hit);
    }
  }
  const selected = wanted
    .map((id) => byId.get(id))
    .filter((hit): hit is T => Boolean(hit));
  if (selected.length === 0) {
    return options.failClosed ? [] : options.hits;
  }
  const opened = await Promise.all(
    selected.map(async (hit) => {
      try {
        const opened = await options.openOne(hit);
        if (options.failClosed && normalizeId(options.idOf(opened)) !== normalizeId(options.idOf(hit))) {
          throw new Error("Opened integration source identity changed.");
        }
        return opened;
      } catch (error) {
        if (options.failClosed) throw error;
        return hit;
      }
    })
  );
  if (options.failClosed) return opened;
  const openedById = new Map<string, T>();
  for (const hit of opened) {
    const key = normalizeId(options.idOf(hit));
    if (key) {
      openedById.set(key, hit);
    }
  }
  return options.hits.map((hit) => {
    const key = normalizeId(options.idOf(hit));
    return key && openedById.has(key) ? (openedById.get(key) as T) : hit;
  });
}

export function clipOpenedBody(value: string | undefined, max: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}
