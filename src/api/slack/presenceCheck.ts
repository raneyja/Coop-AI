import type { SlackClient } from "./slackClient";
import type { OwnershipScore, SlackPresenceState, SlackPresenceStatus } from "../../types/ownership";

const PRESENCE_CACHE_TTL_MS = 2 * 60 * 1000;
const USER_RESOLVE_CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry<T> = { data: T; expiresAt: number };

const presenceCache = new Map<string, CacheEntry<SlackPresenceStatus>>();
const githubToSlackCache = new Map<string, CacheEntry<string | undefined>>();

export type PresenceCheckOptions = {
  now?: () => number;
};

export async function checkSlackPresence(
  client: SlackClient,
  slackUserId: string,
  options?: PresenceCheckOptions
): Promise<SlackPresenceStatus> {
  const now = options?.now ?? (() => Date.now());
  const cached = presenceCache.get(slackUserId);
  if (cached && cached.expiresAt > now()) {
    return cached.data;
  }

  const [presence, userInfo] = await Promise.all([
    client.getUserPresence(slackUserId),
    client.getUserInfo(slackUserId).catch(() => undefined)
  ]);

  const status: SlackPresenceStatus = {
    state: mapPresenceState(presence.presence, presence.autoAway),
    label: "",
    timezone: userInfo?.timezone,
    slackUserId
  };
  status.label = formatPresenceLabel(status, now());

  presenceCache.set(slackUserId, {
    data: status,
    expiresAt: now() + PRESENCE_CACHE_TTL_MS
  });
  return status;
}

export async function resolveSlackUserForGithubLogin(
  client: SlackClient,
  githubLogin: string,
  email?: string,
  options?: PresenceCheckOptions
): Promise<string | undefined> {
  const now = options?.now ?? (() => Date.now());
  const cacheKey = `${githubLogin}:${email ?? ""}`.toLowerCase();
  const cached = githubToSlackCache.get(cacheKey);
  if (cached && cached.expiresAt > now()) {
    return cached.data;
  }

  let resolved: string | undefined;

  if (email) {
    resolved = await client.findUserByEmail(email).catch(() => undefined);
  }

  if (!resolved) {
    resolved = await client.findUserByName(githubLogin).catch(() => undefined);
  }

  githubToSlackCache.set(cacheKey, {
    data: resolved,
    expiresAt: now() + USER_RESOLVE_CACHE_TTL_MS
  });
  return resolved;
}

export async function enrichScoresWithPresence(
  scores: OwnershipScore[],
  client: SlackClient,
  options?: PresenceCheckOptions
): Promise<OwnershipScore[]> {
  const enriched = await Promise.all(
    scores.map(async (score) => {
      const slackUserId = await resolveSlackUserForGithubLogin(client, score.owner);
      if (!slackUserId) {
        return {
          ...score,
          presence: {
            state: "unknown" as SlackPresenceState,
            label: "Presence unknown"
          }
        };
      }
      const presence = await checkSlackPresence(client, slackUserId, options);
      return { ...score, presence };
    })
  );
  return enriched;
}

export function formatPresenceLabel(status: SlackPresenceStatus, now = Date.now()): string {
  switch (status.state) {
    case "active": {
      const time = localTimeInTimezone(now, status.timezone);
      return time ? `Active (${time})` : "Active";
    }
    case "away":
      return status.lastActive ? `Away (last active ${status.lastActive})` : "Away";
    case "dnd":
      return "Do Not Disturb";
    case "offline":
      return status.lastActive ? `Offline (last active ${status.lastActive})` : "Offline";
    default:
      return "Availability unknown";
  }
}

function mapPresenceState(presence: string, autoAway?: boolean): SlackPresenceState {
  if (presence === "active" && !autoAway) {
    return "active";
  }
  if (presence === "active" && autoAway) {
    return "away";
  }
  if (presence === "away") {
    return "away";
  }
  return "offline";
}

function localTimeInTimezone(now: number, timezone?: string): string | undefined {
  if (!timezone) {
    return undefined;
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short"
    }).format(new Date(now));
  } catch {
    return undefined;
  }
}

export function clearPresenceCaches(): void {
  presenceCache.clear();
  githubToSlackCache.clear();
}
