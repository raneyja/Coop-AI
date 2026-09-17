/** Billing contact is always an active member of this org. Never copy another org's email. */

export type BillingEmailUser = {
  email?: string | null;
  role?: string | null;
  deactivatedAt?: Date | string | null;
  createdAt?: Date | string;
};

export type BillingContactResult = {
  email: string | undefined;
  /** True when stored email was missing or belonged to someone outside this org. */
  healed: boolean;
  options: string[];
};

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isActive(user: BillingEmailUser): boolean {
  return !user.deactivatedAt && Boolean(normalizeEmail(user.email));
}

function createdAtMs(user: BillingEmailUser): number {
  if (!user.createdAt) {
    return Number.MAX_SAFE_INTEGER;
  }
  const ms = user.createdAt instanceof Date ? user.createdAt.getTime() : Date.parse(String(user.createdAt));
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function isAdminRole(role: string | null | undefined): boolean {
  const value = String(role ?? "").toLowerCase();
  return value === "admin" || value === "owner";
}

export function billingEmailOptions(users: BillingEmailUser[]): string[] {
  const active = users.filter(isActive).sort((left, right) => {
    const adminDelta = Number(isAdminRole(right.role)) - Number(isAdminRole(left.role));
    if (adminDelta !== 0) {
      return adminDelta;
    }
    return createdAtMs(left) - createdAtMs(right);
  });
  const seen = new Set<string>();
  const options: string[] = [];
  for (const user of active) {
    const email = normalizeEmail(user.email);
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    options.push(email);
  }
  return options;
}

/**
 * Prefer a stored billing email only if that person is still an active member
 * of this org. Otherwise use the founding admin (earliest active admin), then
 * the earliest active member.
 */
export function resolveBillingContact(options: {
  storedEmail?: string | null;
  users: BillingEmailUser[];
}): BillingContactResult {
  const contacts = billingEmailOptions(options.users);
  const stored = normalizeEmail(options.storedEmail);
  if (stored && contacts.includes(stored)) {
    return { email: stored, healed: false, options: contacts };
  }
  const foundingAdmin = options.users
    .filter((user) => isActive(user) && isAdminRole(user.role))
    .sort((left, right) => createdAtMs(left) - createdAtMs(right))[0];
  const fallback =
    normalizeEmail(foundingAdmin?.email) ||
    contacts[0] ||
    undefined;
  return {
    email: fallback,
    healed: Boolean(fallback) && fallback !== stored,
    options: contacts
  };
}

export function billingEmailBelongsToOrg(
  email: string | null | undefined,
  users: BillingEmailUser[]
): boolean {
  const normalized = normalizeEmail(email);
  return Boolean(normalized) && billingEmailOptions(users).includes(normalized);
}
