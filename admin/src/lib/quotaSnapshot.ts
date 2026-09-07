/** Keep credit math aligned with src/server/planQuota.ts TOKENS_PER_CREDIT. */
const TOKENS_PER_CREDIT = 1_000;

export type QuotaCredits = {
  usedCredits: number;
  limitCredits: number;
  remainingCredits: number;
  windowHours: number;
  resetsAt?: string;
};

export type QuotaSnapshotFields = {
  plan?: string;
  usageTier?: string | null;
  unlimited?: boolean;
  usedTokens?: number;
  limitTokens?: number;
  remainingTokens?: number;
  usedCredits?: number;
  limitCredits?: number;
  remainingCredits?: number;
  windowHours?: number;
  resetsAt?: string;
  retryAfterMs?: number;
  usageMeters?: unknown;
  quota?: QuotaSnapshotFields;
};

function pickFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, value);
    }
  }
  return undefined;
}

function tokensToCredits(tokens: number | undefined): number | undefined {
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) {
    return undefined;
  }
  return Math.ceil(tokens / TOKENS_PER_CREDIT);
}

/** Unwrap nested `/v1/admin/quota` payloads so the dashboard can read credits. */
export function normalizeQuotaSnapshot(data?: QuotaSnapshotFields | null): QuotaSnapshotFields {
  const nested = data?.quota && typeof data.quota === "object" ? data.quota : undefined;
  const plan =
    typeof data?.plan === "string" && data.plan.trim()
      ? data.plan.trim()
      : typeof nested?.plan === "string" && nested.plan.trim()
        ? nested.plan.trim()
        : "free";
  const usedTokens = pickFiniteNumber(data?.usedTokens, nested?.usedTokens);
  const limitTokens = pickFiniteNumber(data?.limitTokens, nested?.limitTokens);
  const remainingTokens = pickFiniteNumber(data?.remainingTokens, nested?.remainingTokens);
  const usedCredits =
    pickFiniteNumber(data?.usedCredits, nested?.usedCredits) ?? tokensToCredits(usedTokens);
  const limitCredits =
    pickFiniteNumber(data?.limitCredits, nested?.limitCredits) ?? tokensToCredits(limitTokens);
  const remainingCredits =
    pickFiniteNumber(data?.remainingCredits, nested?.remainingCredits) ??
    (typeof usedCredits === "number" && typeof limitCredits === "number"
      ? Math.max(0, limitCredits - usedCredits)
      : tokensToCredits(remainingTokens));

  return {
    ...nested,
    ...data,
    plan,
    usedTokens,
    limitTokens,
    remainingTokens,
    usedCredits,
    limitCredits,
    remainingCredits,
    windowHours: data?.windowHours ?? nested?.windowHours,
    resetsAt: data?.resetsAt ?? nested?.resetsAt,
    retryAfterMs: data?.retryAfterMs ?? nested?.retryAfterMs,
    usageMeters: data?.usageMeters ?? nested?.usageMeters ?? null
  };
}

export function resolveFreeQuotaCredits(snapshot?: QuotaSnapshotFields | null): QuotaCredits | null {
  const normalized = normalizeQuotaSnapshot(snapshot ?? undefined);
  const limitCredits = normalized.limitCredits;
  const usedCredits = normalized.usedCredits;
  if (typeof limitCredits !== "number" || typeof usedCredits !== "number") {
    return null;
  }
  const remainingCredits =
    typeof normalized.remainingCredits === "number"
      ? normalized.remainingCredits
      : Math.max(0, limitCredits - usedCredits);
  return {
    usedCredits,
    limitCredits,
    remainingCredits,
    windowHours: normalized.windowHours ?? 5,
    resetsAt: normalized.resetsAt
  };
}

export function isFreeQuotaExhausted(credits: QuotaCredits): boolean {
  return credits.remainingCredits <= 0 || credits.usedCredits >= credits.limitCredits;
}

export function quotaUsedPercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}
