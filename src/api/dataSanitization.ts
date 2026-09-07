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

/**
 * Identifier / object-property rules. Only quoted secret *literals* — never
 * `token: hashedToken` or `token = self.get(...)` which /edit SEARCH must keep exact.
 */
const CODE_RULES: ReplacementRule[] = [
  {
    type: "api_key",
    pattern: /\b(api[_-]?key)\s*[:=]\s*(['"])([^'"\n]+)\2/gi,
    replacement: "$1=$2API_KEY_REDACTED$2"
  },
  {
    type: "password",
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*(['"])([^'"\n]+)\2/gi,
    replacement: "$1=$2PASSWORD_REDACTED$2"
  },
  {
    type: "token",
    pattern: /\b(access[_-]?token|auth[_-]?token|refresh[_-]?token|api[_-]?token|token)\s*[:=]\s*(['"])([^'"\n]+)\2/gi,
    replacement: "$1=$2TOKEN_REDACTED$2"
  },
  {
    type: "secret",
    pattern: /\b(secret|client[_-]?secret|signing[_-]?secret)\s*[:=]\s*(['"])([^'"\n]+)\2/gi,
    replacement: "$1=$2SECRET_REDACTED$2"
  },
  {
    type: "comment_secret",
    // Assignment in a comment only — not class names (APIKeyAuthentication) or
    // docs that mention tokens. Compact JSON has no real newlines, so this must
    // never run against stringified tool results (see sanitizeAgentToolTree).
    pattern:
      /(\/\/|#|\/\*)[^\n]*\b(?:password|secret|api[_-]key|access[_-]token|auth[_-]token)\s*[:=]\s*(?:['"][^'"]+['"]|\S+)/gi,
    replacement: "$1 [REDACTED_SENSITIVE_COMMENT]"
  }
];

/** Always-safe redactionsactions: high-entropy provider tokens, PII — OK inside code attachments. */
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

/**
 * Authoritative code the model must copy into SEARCH/REPLACE. Only GENERAL_RULES
 * run inside these blocks so identifier lines like `token: hashedToken` stay exact.
 */
const CODE_ATTACHMENT_BLOCK_PATTERN =
  /<(file_content|editor_selection|local_files|mentioned_files|file)\b[^>]*>[\s\S]*?<\/\1>|<(file)\b[^>]*\/>/gi;

const DECISION_KEYWORDS = [
  "decision",
  "decided",
  "chose",
  "choice",
  "tradeoff",
  "trade-off",
  "architecture",
  "rfc",
  "adr",
  "proposal",
  "approved",
  "rejected",
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
    return sanitizeMessageOrCodeString(value, counts);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry, counts));
  }
  if (value && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>, counts);
  }
  return value;
}

function sanitizeMessageOrCodeString(value: string, counts: MutableFindingCounts): string {
  const toolJson = tryParseAgentToolJson(value);
  if (toolJson !== undefined) {
    return JSON.stringify(sanitizeAgentToolTree(toolJson, counts));
  }

  if (!CODE_ATTACHMENT_BLOCK_PATTERN.test(value)) {
    return sanitizeText(value, [...CODE_RULES, ...GENERAL_RULES], counts).value;
  }
  // Reset lastIndex after test() on a global regex.
  CODE_ATTACHMENT_BLOCK_PATTERN.lastIndex = 0;

  const preserved: string[] = [];
  const withPlaceholders = value.replace(CODE_ATTACHMENT_BLOCK_PATTERN, (block) => {
    const index = preserved.length;
    // Inside attachments: only high-entropy secrets / PII — never identifier CODE_RULES.
    preserved.push(sanitizeText(block, GENERAL_RULES, counts).value);
    return `\0COOP_CODE_BLOCK_${index}\0`;
  });

  const sanitizedOutside = sanitizeText(withPlaceholders, [...CODE_RULES, ...GENERAL_RULES], counts).value;
  return sanitizedOutside.replace(/\0COOP_CODE_BLOCK_(\d+)\0/g, (_, index) => preserved[Number(index)] ?? "");
}

/**
 * Agent read_file / search_code results are JSON.stringify'd (newlines become
 * the two-character sequence \\n). Comment rules that use [^\n]* then treat the
 * whole file as one line and wipe class names like APIKeyAuthentication.
 * Decode first; sanitize file bodies like <file_content> (GENERAL_RULES only).
 */
function tryParseAgentToolJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isAgentToolPayload(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isAgentToolPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.files) ||
    Array.isArray(record.hits) ||
    Array.isArray(record.preferredHits) ||
    Array.isArray(record.symbols)
  );
}

function sanitizeAgentToolTree(value: unknown, counts: MutableFindingCounts): unknown {
  if (typeof value === "string") {
    return sanitizeText(value, GENERAL_RULES, counts).value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAgentToolTree(entry, counts));
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeAgentToolTree(entry, counts);
    }
    return sanitized;
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

/**
 * Apply replacement rules. String templates with `$1` / `$2` must be expanded manually
 * when using a function replacer — otherwise the model sees literal `$1=$2TOKEN_REDACTED$2`
 * and SEARCH/REPLACE can never match the live file.
 */
function sanitizeText(
  value: string,
  rules: ReplacementRule[],
  counts: MutableFindingCounts = {}
): { value: string; counts: MutableFindingCounts } {
  let result = value;
  for (const rule of rules) {
    // Clone so lastIndex from a prior pass cannot skip matches on global patterns.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    result = result.replace(pattern, (...args: unknown[]) => {
      increment(counts, rule.type);
      const match = String(args[0] ?? "");
      if (typeof rule.replacement === "function") {
        const groups = args.slice(1, -2) as string[];
        return rule.replacement(match, ...groups);
      }
      return expandDollarReplacement(rule.replacement, match, args.slice(1, -2) as string[]);
    });
  }
  return { value: result, counts };
}

function expandDollarReplacement(template: string, fullMatch: string, groups: string[]): string {
  return template
    .replace(/\$\$/g, "\u0000")
    .replace(/\$&/g, fullMatch)
    .replace(/\$(\d+)/g, (_, index) => {
      const group = groups[Number(index) - 1];
      return group !== undefined ? group : "";
    })
    .replace(/\u0000/g, "$");
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
