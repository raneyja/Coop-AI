import {
  findPersonInDirectory,
  slackTargetForPerson
} from "../../identity/identityDirectory";
import type { IdentityDirectory, IdentityLinkSource } from "../../identity/types";
import type { SlackClient } from "./slackClient";
import type { OwnershipScore, SlackPresenceState, SlackPresenceStatus } from "../../types/ownership";

const PRESENCE_CACHE_TTL_MS = 2 * 60 * 1000;
const USER_RESOLVE_CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry<T> = { data: T; expiresAt: number };

const presenceCache = new Map<string, CacheEntry<SlackPresenceStatus>>();
const githubToSlackCache = new Map<string, CacheEntry<SlackResolveResult>>();

export type PresenceCheckOptions = {
  now?: () => number;
  identityDirectory?: IdentityDirectory;
};

export type GithubSlackIdentity = {
  displayName?: string;
  githubLogin?: string;
  email?: string;
};

type SlackResolveResult = {
  userId?: string;
  source: IdentityLinkSource | "none";
  linkedPerson?: boolean;
};

export function buildSlackLookupCandidates(identity: GithubSlackIdentity): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(trimmed);
  };

  if (identity.email) {
    add(identity.email);
  }
  if (identity.githubLogin) {
    add(identity.githubLogin);
  }
  if (identity.displayName) {
    add(identity.displayName);
    const [firstName] = identity.displayName.split(/\s+/);
    add(firstName);
  }

  return candidates;
}

export async function checkSlackPresence(
  client: SlackClient,
  slackUserId: string,
  options?: PresenceCheckOptions
): Promise<SlackPresenceStatus> {
  const now = options?.now ?? (() => Date.now());
  const cached = presenceCache.get(slackUserId);
  if (cached && cached.expiresAt > now()) {
    return { ...cached.data };
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
  return { ...status };
}

async function resolveFromDirectory(
  client: SlackClient,
  directory: IdentityDirectory,
  identity: GithubSlackIdentity
): Promise<string | undefined> {
  const person = findPersonInDirectory(directory, identity);
  if (!person) {
    return undefined;
  }

  const target = slackTargetForPerson(person);
  if (target.userId) {
    return target.userId;
  }

  for (const email of target.emails) {
    const resolved = await client.findUserByEmail(email).catch(() => undefined);
    if (resolved) {
      return resolved;
    }
  }

  if (target.handle) {
    return client.findUserByName(target.handle).catch(() => undefined);
  }

  return undefined;
}

async function resolveInferredSlackUser(
  client: SlackClient,
  identity: GithubSlackIdentity
): Promise<string | undefined> {
  for (const candidate of buildSlackLookupCandidates(identity)) {
    if (candidate.includes("@")) {
      const resolved = await client.findUserByEmail(candidate).catch(() => undefined);
      if (resolved) {
        return resolved;
      }
      continue;
    }
    const resolved = await client.findUserByName(candidate).catch(() => undefined);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

export async function resolveSlackUserForGithubIdentity(
  client: SlackClient,
  identity: GithubSlackIdentity,
  options?: PresenceCheckOptions
): Promise<SlackResolveResult> {
  const now = options?.now ?? (() => Date.now());
  const cacheKey = [
    buildSlackLookupCandidates(identity).join("|"),
    options?.identityDirectory?.people.length ?? 0
  ]
    .join("::")
    .toLowerCase();
  const cached = githubToSlackCache.get(cacheKey);
  if (cached && cached.expiresAt > now()) {
    return cached.data;
  }

  const linkedPerson = Boolean(
    options?.identityDirectory && findPersonInDirectory(options.identityDirectory, identity)
  );

  let userId: string | undefined;
  let source: IdentityLinkSource | "none" = "none";

  if (options?.identityDirectory) {
    userId = await resolveFromDirectory(client, options.identityDirectory, identity);
    if (userId) {
      source = "explicit";
    }
  }

  if (!userId) {
    userId = await resolveInferredSlackUser(client, identity);
    if (userId) {
      source = "inferred";
    }
  }

  const result: SlackResolveResult = { userId, source, linkedPerson };
  githubToSlackCache.set(cacheKey, {
    data: result,
    expiresAt: now() + USER_RESOLVE_CACHE_TTL_MS
  });
  return result;
}

export async function resolveSlackUserForGithubLogin(
  client: SlackClient,
  githubLogin: string,
  email?: string,
  options?: PresenceCheckOptions
): Promise<string | undefined> {
  const resolved = await resolveSlackUserForGithubIdentity(
    client,
    { displayName: githubLogin, githubLogin, email },
    options
  );
  return resolved.userId;
}

export async function enrichScoresWithPresence(
  scores: OwnershipScore[],
  client: SlackClient,
  options?: PresenceCheckOptions
): Promise<OwnershipScore[]> {
  const enriched = await Promise.all(
    scores.map(async (score) => {
      const resolved = await resolveSlackUserForGithubIdentity(client, {
        displayName: score.owner,
        githubLogin: score.githubLogin
      }, options);

      if (!resolved.userId) {
        return {
          ...score,
          presence: {
            state: "unknown" as SlackPresenceState,
            label: resolved.linkedPerson ? "Linked · Slack user not found" : "Not linked"
          }
        };
      }

      const presence = await checkSlackPresence(client, resolved.userId, options);
      const label = buildPresenceDisplayLabel(presence, resolved, options?.now?.() ?? Date.now());
      return { ...score, presence: { ...presence, label } };
    })
  );
  return enriched;
}

export function buildPresenceDisplayLabel(
  presence: SlackPresenceStatus,
  resolved: Pick<SlackResolveResult, "linkedPerson" | "source">,
  now = Date.now()
): string {
  const baseLabel = formatPresenceLabel(presence, now);
  if (resolved.linkedPerson) {
    return `${baseLabel} · linked`;
  }
  if (resolved.source === "inferred") {
    return `${baseLabel} · inferred`;
  }
  return baseLabel;
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
