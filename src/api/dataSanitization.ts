export type SanitizationFindingType =
  | "api_key"
  | "password"
  | "token"
  | "secret"
  | "email"
  | "phone"
  | "ssn"
  | "internal_path"
  | "mention"
  | "name"
  | "comment_secret";

export type SanitizationFinding = {
  type: SanitizationFindingType;
  count: number;
};

export type SanitizationReport = {
  sanitized: boolean;
  findings: SanitizationFinding[];
};

export type LlmPayloadLike = {
  messages?: Array<{ role: string; content: string; name?: string }>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type SanitizedPayload<T extends LlmPayloadLike> = {
  payload: T;
  report: SanitizationReport;
};

type MutableFindingCounts = Partial<Record<SanitizationFindingType, number>>;

type ReplacementRule = {
  type: SanitizationFindingType;
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
};

const SECRET_VALUE = "[REDACTED_SECRET]";
const EMAIL_VALUE = "[REDACTED_EMAIL]";
const PHONE_VALUE = "[REDACTED_PHONE]";
const SSN_VALUE = "[REDACTED_SSN]";
const INTERNAL_PATH_VALUE = "[INTERNAL_PATH]";
const MENTION_VALUE = "[REDACTED_MENTION]";
const NAME_VALUE = "[REDACTED_NAME]";

const CODE_RULES: ReplacementRule[] = [
  {
    type: "api_key",
    pattern: /\b(api[_-]?key)\s*[:=]\s*(['"]?)([^'"\s,;]+)/gi,
    replacement: "$1=$2API_KEY_REDACTED$2"
  },
  {
    type: "password",
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*(['"]?)([^'"\s,;]+)/gi,
    replacement: "$1=$2PASSWORD_REDACTED$2"
  },
  {
    type: "token",
    pattern: /\b(access[_-]?token|auth[_-]?token|refresh[_-]?token|token)\s*[:=]\s*(['"]?)([^'"\s,;]+)/gi,
    replacement: "$1=$2TOKEN_REDACTED$2"
  },
  {
    type: "secret",
    pattern: /\b(secret|client[_-]?secret|signing[_-]?secret)\s*[:=]\s*(['"]?)([^'"\s,;]+)/gi,
    replacement: "$1=$2SECRET_REDACTED$2"
  },
  {
    type: "comment_secret",
    pattern: /(\/\/|#|\/\*)[^\n]*(secret|password|token|api[_-]?key)[^\n]*/gi,
    replacement: "$1 [REDACTED_SENSITIVE_COMMENT]"
  }
];

const GENERAL_RULES: ReplacementRule[] = [
  {
    type: "api_key",
    pattern: /\b(sk|pk|rk|ghp|gho|ghu|glpat|xox[baprs])_[A-Za-z0-9_-]{12,}\b/g,
    replacement: maskSecretToken
  },
  {
    type: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: EMAIL_VALUE
  },
  {
    type: "phone",
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: PHONE_VALUE
  },
  {
    type: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: SSN_VALUE
  },
  {
    type: "internal_path",
    pattern: /(?:^|[\s"'`(])\/(?:internal|private|corp|billing|payroll|finance|legal)\/[A-Za-z0-9._/-]+/g,
    replacement: (match: string) => preservePrefix(match, INTERNAL_PATH_VALUE)
  },
  {
    type: "password",
    pattern: /\b(password)\s*:\s*[^\n,;]+/gi,
    replacement: "$1: ****"
  }
];

const SLACK_TEAMS_RULES: ReplacementRule[] = [
  {
    type: "mention",
    pattern: /<@[A-Z0-9]+>|@[a-z0-9._-]+/gi,
    replacement: MENTION_VALUE
  },
  {
    type: "name",
    pattern: /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g,
    replacement: NAME_VALUE
  }
];

const DECISION_KEYWORDS = [
  "approved",
  "blocked",
  "rejected",
  "ship",
  "rollback",
  "defer",
  "owner",
  "risk",
  "security",
  "privacy",
  "incident",
  "customer",
  "deadline",
  "migration",
  "release"
];

export function sanitizeCode(code: string): string {
  return sanitizeText(code, [...CODE_RULES, ...GENERAL_RULES]).value;
}

export function sanitizePlainText(text: string): string {
  return sanitizeText(text, GENERAL_RULES).value;
}

export function sanitizeSlackTeamsMessage(message: string): string {
  const sanitized = sanitizeText(message, [...SLACK_TEAMS_RULES, ...GENERAL_RULES]).value;
  const foundKeywords = DECISION_KEYWORDS.filter((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(sanitized));
  const references = extractIssueAndPrReferences(sanitized);
  const compact = [...foundKeywords, ...references].join(" ");
  return compact || "[NO_RELEVANT_DECISION_KEYWORDS]";
}

export function sanitizeLlmRequestPayload<T extends LlmPayloadLike>(payload: T): SanitizedPayload<T> {
  const counts: MutableFindingCounts = {};
  const cloned = sanitizeUnknown(deepClone(payload), counts) as T;
  return {
    payload: cloned,
    report: buildReport(counts)
  };
}

export function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const counts: MutableFindingCounts = {};
  return sanitizeUnknown(headers, counts) as Record<string, unknown>;
}

export function sanitizeErrorText(text: string): string {
  return sanitizePlainText(text)
    .replace(/code snippet:\s*.+/gi, "code context (sanitized)")
    .replace(/request body:\s*.+/gi, "request body (sanitized)")
    .replace(/authorization:\s*Bearer\s+\S+/gi, "authorization: Bearer [REDACTED]");
}

function sanitizeUnknown(value: unknown, counts: MutableFindingCounts): unknown {
  if (typeof value === "string") {
    return sanitizeText(value, [...CODE_RULES, ...GENERAL_RULES], counts).value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry, counts));
  }
  if (value && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>, counts);
  }
  return value;
}

function sanitizeObject(value: Record<string, unknown>, counts: MutableFindingCounts): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      increment(counts, keyToFindingType(key));
      sanitized[key] = SECRET_VALUE;
      continue;
    }
    sanitized[key] = sanitizeUnknown(entry, counts);
  }
  return sanitized;
}

function sanitizeText(
  value: string,
  rules: ReplacementRule[],
  counts: MutableFindingCounts = {}
): { value: string; counts: MutableFindingCounts } {
  let result = value;
  for (const rule of rules) {
    result = result.replace(rule.pattern, (match: string) => {
      increment(counts, rule.type);
      if (typeof rule.replacement === "function") {
        return rule.replacement(match);
      }
      return rule.replacement;
    });
  }
  return { value: result, counts };
}

function maskSecretToken(match: string): string {
  const suffix = match.slice(-4);
  const prefix = match.split("_")[0] ?? "token";
  return `${prefix}_***${suffix}`;
}

function preservePrefix(match: string, replacement: string): string {
  const first = match[0];
  return first && /\s|["'`(]/.test(first) ? `${first}${replacement}` : replacement;
}

function extractIssueAndPrReferences(message: string): string[] {
  const refs = new Set<string>();
  for (const match of message.matchAll(/(?:#\d+|PR\s+\d+|pull request\s+\d+|issue\s+\d+)/gi)) {
    refs.add(match[0]);
  }
  return [...refs];
}

function isSensitiveKey(key: string): boolean {
  return /(api[_-]?key|password|passwd|pwd|token|secret|authorization|cookie|session)/i.test(key);
}

function keyToFindingType(key: string): SanitizationFindingType {
  if (/api[_-]?key/i.test(key)) {
    return "api_key";
  }
  if (/password|passwd|pwd/i.test(key)) {
    return "password";
  }
  if (/token|authorization|cookie|session/i.test(key)) {
    return "token";
  }
  return "secret";
}

function increment(counts: MutableFindingCounts, type: SanitizationFindingType): void {
  counts[type] = (counts[type] ?? 0) + 1;
}

function buildReport(counts: MutableFindingCounts): SanitizationReport {
  const findings = Object.entries(counts)
    .filter(([, count]) => Boolean(count))
    .map(([type, count]) => ({ type: type as SanitizationFindingType, count: count ?? 0 }));
  return {
    sanitized: findings.length > 0,
    findings
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
