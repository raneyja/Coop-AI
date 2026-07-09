import { principalForApiKey, principalForUser } from "./audit/auditLogger";

export type OrgMemberRef = {
  id: string;
  email: string;
};

export type ResolvedPrincipal = {
  /** Canonical key for merging (`user:<id>`, `apikey:<id>`, or raw principal). */
  key: string;
  /** Human label for tables (email, API key label, or principal). */
  label: string;
  kind: "member" | "apikey" | "other";
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Map usage-event principal strings to org members for analytics rollups.
 * Merges legacy aliases (`<uuid>` vs `user:<uuid>` vs email).
 */
export function buildPrincipalResolver(members: OrgMemberRef[]): {
  resolve(principal: string): ResolvedPrincipal;
} {
  const aliasToKey = new Map<string, string>();
  const labelByKey = new Map<string, string>();

  for (const member of members) {
    const key = principalForUser(member.id);
    const email = member.email.trim();
    const label = email || key;
    labelByKey.set(key, label);
    aliasToKey.set(key, key);
    aliasToKey.set(member.id, key);
    if (email) {
      aliasToKey.set(email, key);
      aliasToKey.set(normalizeEmail(email), key);
    }
  }

  return {
    resolve(principal: string): ResolvedPrincipal {
      const trimmed = principal.trim();
      if (!trimmed) {
        return { key: "unknown", label: "Unknown", kind: "other" };
      }
      if (trimmed.startsWith("apikey:")) {
        const key = trimmed;
        return {
          key,
          label: `API key ${trimmed.slice("apikey:".length).slice(0, 8)}…`,
          kind: "apikey"
        };
      }
      const direct = aliasToKey.get(trimmed) ?? aliasToKey.get(normalizeEmail(trimmed));
      if (direct) {
        return { key: direct, label: labelByKey.get(direct) ?? direct, kind: "member" };
      }
      if (trimmed.startsWith("user:")) {
        const userId = trimmed.slice("user:".length);
        const viaId = aliasToKey.get(userId);
        if (viaId) {
          return { key: viaId, label: labelByKey.get(viaId) ?? trimmed, kind: "member" };
        }
      }
      return { key: trimmed, label: trimmed, kind: "other" };
    }
  };
}

export function mergePrincipalCounts(
  rows: Array<{ principal: string; count: number }>,
  members: OrgMemberRef[]
): Array<{ principal: string; email?: string; count: number; kind: ResolvedPrincipal["kind"] }> {
  const resolver = buildPrincipalResolver(members);
  const merged = new Map<string, { principal: string; email?: string; count: number; kind: ResolvedPrincipal["kind"] }>();
  for (const row of rows) {
    const resolved = resolver.resolve(row.principal);
    const existing = merged.get(resolved.key);
    if (existing) {
      existing.count += row.count;
      continue;
    }
    merged.set(resolved.key, {
      principal: resolved.key,
      email: resolved.kind === "member" ? resolved.label : undefined,
      count: row.count,
      kind: resolved.kind
    });
  }
  return [...merged.values()].sort((a, b) => b.count - a.count);
}

export function countDistinctResolvedPrincipals(
  principals: string[],
  members: OrgMemberRef[]
): number {
  const resolver = buildPrincipalResolver(members);
  const keys = new Set(principals.map((p) => resolver.resolve(p).key));
  return keys.size;
}

export function principalForApiKeyId(apiKeyId: string): string {
  return principalForApiKey(apiKeyId);
}
