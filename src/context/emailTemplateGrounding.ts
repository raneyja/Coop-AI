/**
 * Email-template grounding for ticket-style plain chat (A11).
 *
 * When the ask mentions jobs + email templates / reminders, follow the open job
 * definition → handler imports → email package paths. Never stop at the job
 * definition with “search the repo for templates.”
 *
 * Intent split (Wave 3):
 * - A11 (`isEmailTemplateTicketAsk`) — email/template/reminder + job/schedule signals.
 * - A10 (`isFeatureAddAsk` in existingCapabilityGrounding) — “add feature X” without
 *   those signals. A11 must not claim blocked_by-style tickets; A10 must yield when
 *   `isEmailTemplateTicketAsk` is true (wire email branch before capability branch).
 */

export type EmailTemplateSource =
  | "package-import"
  | "path-literal"
  | "tree-match"
  | "followed-handler";

export type EmailTemplateCandidate = {
  path: string;
  source: EmailTemplateSource;
  reason: string;
};

export type FollowedJobFile = {
  path: string;
  content: string;
  reason: string;
};

export type EmailTemplateResolution = {
  openJobPath: string;
  followedHandlers: Array<{ path: string; reason: string }>;
  triggeredJobs: string[];
  templates: EmailTemplateCandidate[];
  /**
   * Set only after evidence was searched and no template path was found.
   * Never a “you should search” instruction.
   */
  notFoundMessage?: string;
  gaps: string[];
};

const EMAIL_SIGNAL_RE =
  /\b(e-?mails?|mailers?|templates?|reminders?|expiry|expires?|expiration)\b/i;

const JOB_SIGNAL_RE =
  /\b(jobs?|handlers?|sweep|cron|schedul\w*|queue|worker)\b/i;

const REMINDER_OR_EMAIL_JOB_RE =
  /\b(signing[-_\s]?reminders?|reminder[-_\s]?sweep|email[-_\s]?templates?|templates?\s+live)\b/i;

/** Detect ticket asks that need job → email-template path resolution (A11). */
export function isEmailTemplateTicketAsk(message: string | undefined): boolean {
  const text = message?.trim() ?? "";
  if (text.length < 12) {
    return false;
  }
  if (REMINDER_OR_EMAIL_JOB_RE.test(text)) {
    return true;
  }
  // Require both email/template signal and job/schedule signal — keeps A10
  // “add blocked_by” tickets on the existing-capability path.
  return EMAIL_SIGNAL_RE.test(text) && JOB_SIGNAL_RE.test(text);
}

/**
 * Resolve relative import / dynamic-import targets next to the open job file
 * (e.g. `./send-signing-reminders-sweep.handler` → sibling `.ts` / `.tsx`).
 */
export function extractHandlerFollowCandidates(
  openFilePath: string,
  fileContent: string
): string[] {
  const dir = dirnamePosix(openFilePath);
  const hits: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string): void => {
    const cleaned = raw.trim().replace(/['"`]/g, "");
    if (!cleaned.startsWith(".")) {
      return;
    }
    const resolved = normalizePosix(`${dir}/${cleaned}`);
    for (const withExt of withTsExtensions(resolved)) {
      if (seen.has(withExt)) {
        continue;
      }
      seen.add(withExt);
      hits.push(withExt);
    }
  };

  for (const match of fileContent.matchAll(
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g
  )) {
    push(match[1]!);
  }
  for (const match of fileContent.matchAll(
    /\bfrom\s+['"](\.[^'"]+)['"]/g
  )) {
    const spec = match[1]!;
    if (/\.handler(?:\.[cm]?[jt]sx?)?$|\/handlers?\//i.test(spec) || /\.handler$/i.test(spec)) {
      push(spec);
    }
  }

  // Convention: foo.ts ↔ foo.handler.ts when the definition imports the handler by name.
  const base = basenamePosix(openFilePath).replace(/\.[cm]?[jt]sx?$/, "");
  if (base && !base.endsWith(".handler")) {
    for (const withExt of withTsExtensions(normalizePosix(`${dir}/${base}.handler`))) {
      if (!seen.has(withExt)) {
        seen.add(withExt);
        hits.push(withExt);
      }
    }
  }

  return hits;
}

/** Job names triggered from a file (`jobs.triggerJob({ name: '…' })`). */
export function extractTriggeredJobNames(fileContent: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of fileContent.matchAll(
    /\bname\s*:\s*['"`]([a-z][a-z0-9_.-]{2,})['"`]/gi
  )) {
    const name = match[1]!.trim();
    const lookbackStart = Math.max(0, (match.index ?? 0) - 120);
    const window = fileContent.slice(lookbackStart, (match.index ?? 0) + match[0].length + 40);
    if (!/triggerJob|\.trigger\(|enqueue|queue\.|jobs\./i.test(window) && !/\./.test(name)) {
      continue;
    }
    if (!/\./.test(name) && !/triggerJob|\.trigger\(/i.test(window)) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Map a job id like `internal.process-signing-reminder` to sibling handler paths
 * under the same jobs directory as the open file.
 */
export function handlerPathsForTriggeredJob(
  openFilePath: string,
  jobName: string
): string[] {
  const dir = dirnamePosix(openFilePath);
  const short = jobName.includes(".") ? jobName.split(".").pop()! : jobName;
  if (!short || short.length < 4) {
    return [];
  }
  const bases = [`${short}`, `${short}.handler`];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const base of bases) {
    for (const withExt of withTsExtensions(normalizePosix(`${dir}/${base}`))) {
      if (seen.has(withExt)) {
        continue;
      }
      seen.add(withExt);
      out.push(withExt);
    }
  }
  return out;
}

/**
 * Extract email template path candidates from source (package imports + literals).
 * Maps `@scope/email/templates/foo` → `packages/email/templates/foo.tsx`.
 */
export function extractEmailTemplateRefsFromSource(
  fileContent: string,
  options?: { sourcePath?: string; source?: EmailTemplateSource }
): EmailTemplateCandidate[] {
  const source = options?.source ?? "package-import";
  const fromLabel = options?.sourcePath ? ` from \`${options.sourcePath}\`` : "";
  const candidates: EmailTemplateCandidate[] = [];
  const seen = new Set<string>();

  const push = (path: string, reason: string, src: EmailTemplateSource = source): void => {
    const normalized = normalizeTemplatePath(path);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push({ path: normalized, source: src, reason });
  };

  for (const match of fileContent.matchAll(
    /@[\w-]+\/email\/(templates|template-components)\/([A-Za-z0-9_./-]+)/g
  )) {
    const kind = match[1]!;
    const rest = match[2]!.replace(/\.(tsx?|jsx?)$/i, "");
    push(
      `packages/email/${kind}/${rest}.tsx`,
      `package import \`@…/email/${kind}/${rest}\`${fromLabel}`
    );
  }

  for (const match of fileContent.matchAll(
    /['"`]((?:packages\/)?email\/(?:templates|template-components)\/[A-Za-z0-9_./-]+)['"`]/g
  )) {
    push(match[1]!, `path literal${fromLabel}`, "path-literal");
  }

  for (const match of fileContent.matchAll(
    /['"`]((?:src\/)?(?:emails?|mail)\/(?:templates?\/)?[A-Za-z0-9_./-]+\.(?:tsx?|jsx?|html?))['"`]/gi
  )) {
    push(match[1]!, `path literal${fromLabel}`, "path-literal");
  }

  return candidates;
}

/** Keywords from the user ask used to rank tree/search template hits. */
export function emailTemplateAskKeywords(ask: string | undefined): string[] {
  const text = (ask ?? "").toLowerCase();
  const keywords: string[] = [];
  if (/\bremind/.test(text)) {
    keywords.push("reminder");
  }
  if (/\bexpir/.test(text)) {
    keywords.push("expir", "expired");
  }
  if (/\b24\s*h|twenty[- ]?four/.test(text)) {
    keywords.push("reminder", "expir");
  }
  if (/\bsign/.test(text)) {
    keywords.push("signing");
  }
  if (/\binvite|invitation/.test(text)) {
    keywords.push("invite");
  }
  // Default for vague “email templates” asks — prefer reminder when present in tree.
  if (keywords.length === 0 && /\b(e-?mail|template)/i.test(text)) {
    keywords.push("reminder", "document");
  }
  return [...new Set(keywords.filter((k) => k.length >= 4))];
}

/**
 * Filter Use-repo tree/search paths to email-template files matching ask keywords.
 * Scores against the file basename so `packages/email/…` does not match every path.
 */
export function matchEmailTemplatesInTree(
  treePaths: string[],
  ask?: string
): EmailTemplateCandidate[] {
  const keywords = emailTemplateAskKeywords(ask);
  const askHasSpecificTopic = /\b(remind|expir|sign|invite|24\s*h)/i.test(ask ?? "");
  const candidates: EmailTemplateCandidate[] = [];
  const seen = new Set<string>();

  for (const raw of treePaths) {
    const path = normalizePosix(raw.trim());
    if (!path || seen.has(path)) {
      continue;
    }
    if (!isEmailTemplatePath(path)) {
      continue;
    }
    const base = basenamePosix(path).toLowerCase();
    const score = keywords.reduce((acc, kw) => (base.includes(kw) ? acc + 1 : acc), 0);
    const underTemplates =
      /\/email\/templates\//i.test(path) || /\/emails?\/templates?\//i.test(path);

    if (askHasSpecificTopic) {
      if (score === 0) {
        continue;
      }
    } else if (!underTemplates && score === 0) {
      continue;
    }

    seen.add(path);
    candidates.push({
      path,
      source: "tree-match",
      reason:
        score > 0
          ? `Use-repo tree/search match for ${keywords.filter((k) => base.includes(k)).join(", ") || "email template"}`
          : "Use-repo email templates directory"
    });
  }

  return rankTemplateCandidates(candidates).slice(0, 12);
}

/**
 * Pure resolver: open job file + followed handlers + optional tree/search paths.
 */
export function resolveEmailTemplateCandidates(options: {
  openFilePath: string;
  openFileContent: string;
  followedFiles?: FollowedJobFile[];
  treePaths?: string[];
  ask?: string;
}): EmailTemplateResolution {
  const openJobPath = normalizePosix(options.openFilePath);
  const followedHandlers = (options.followedFiles ?? []).map((f) => ({
    path: normalizePosix(f.path),
    reason: f.reason
  }));

  const templates: EmailTemplateCandidate[] = [];
  const seen = new Set<string>();
  const pushAll = (list: EmailTemplateCandidate[]): void => {
    for (const item of list) {
      if (seen.has(item.path)) {
        continue;
      }
      seen.add(item.path);
      templates.push(item);
    }
  };

  pushAll(
    extractEmailTemplateRefsFromSource(options.openFileContent, {
      sourcePath: openJobPath,
      source: "package-import"
    })
  );

  const triggeredJobs = new Set<string>(extractTriggeredJobNames(options.openFileContent));

  for (const followed of options.followedFiles ?? []) {
    pushAll(
      extractEmailTemplateRefsFromSource(followed.content, {
        sourcePath: followed.path,
        source: "followed-handler"
      }).map((c) => ({
        ...c,
        source: "followed-handler" as const,
        reason: c.reason.includes("from")
          ? c.reason
          : `${c.reason} (followed handler \`${followed.path}\`)`
      }))
    );
    for (const name of extractTriggeredJobNames(followed.content)) {
      triggeredJobs.add(name);
    }
  }

  pushAll(matchEmailTemplatesInTree(options.treePaths ?? [], options.ask));

  const ranked = rankTemplateCandidates(templates).slice(0, 12);
  const gaps: string[] = [];
  if (followedHandlers.length === 0) {
    gaps.push(
      "No handler body was followed from the open job definition — template imports may live in a sibling `*.handler` or a triggered job handler."
    );
  }

  let notFoundMessage: string | undefined;
  if (ranked.length === 0) {
    notFoundMessage =
      "No email template paths found after following job handler imports and searching Use-repo email/template paths. Report this not found result — do not invent template paths.";
  }

  return {
    openJobPath,
    followedHandlers,
    triggeredJobs: [...triggeredJobs],
    templates: ranked,
    notFoundMessage,
    gaps
  };
}

/** Gather query for index search after parsing the open job file. */
export function emailTemplateGatherQuery(options: {
  openFilePath: string;
  openFileContent: string;
  ask?: string;
  followedFiles?: FollowedJobFile[];
}): string | undefined {
  const parts: string[] = [];
  const jobs = [
    ...extractTriggeredJobNames(options.openFileContent),
    ...(options.followedFiles ?? []).flatMap((f) => extractTriggeredJobNames(f.content))
  ];
  for (const job of jobs) {
    parts.push(job);
    const short = job.includes(".") ? job.split(".").pop() : undefined;
    if (short) {
      parts.push(short);
    }
  }
  for (const kw of emailTemplateAskKeywords(options.ask)) {
    parts.push(kw);
  }
  parts.push("email", "templates", "document-reminder");
  const unique = [...new Set(parts.map((p) => p.trim()).filter((p) => p.length >= 3))];
  if (unique.length === 0) {
    return undefined;
  }
  return unique.slice(0, 10).join(" ");
}

export function formatEmailTemplateEvidenceBlock(resolution: EmailTemplateResolution): string {
  const lines: string[] = [];
  lines.push("<email_template_evidence>");
  lines.push(`open_job: ${resolution.openJobPath}`);
  if (resolution.followedHandlers.length) {
    lines.push("followed_handlers:");
    for (const h of resolution.followedHandlers) {
      lines.push(`- ${h.path} — ${h.reason}`);
    }
  }
  if (resolution.triggeredJobs.length) {
    lines.push(`triggered_jobs: ${resolution.triggeredJobs.join(", ")}`);
  }
  lines.push("email_templates:");
  if (resolution.templates.length === 0) {
    lines.push(
      `- NOT FOUND — ${resolution.notFoundMessage ?? "no template paths in evidence"}`
    );
  } else {
    for (const t of resolution.templates) {
      lines.push(`- \`${t.path}\` (${t.source}) — ${t.reason}`);
    }
  }
  if (resolution.gaps.length) {
    lines.push("gaps:");
    for (const gap of resolution.gaps) {
      lines.push(`- ${gap}`);
    }
  }
  lines.push("</email_template_evidence>");
  return lines.join("\n");
}

/** Synthesis user prompt for email-template ticket plain chat. */
export function buildEmailTemplateSynthesisUserPrompt(options: {
  ask: string;
  resolution: EmailTemplateResolution;
  userMessage?: string;
}): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(
    options.ask.trim() ||
      "Locate scheduled jobs and email templates and explain how a reminder should hook into the existing sweep."
  );
  lines.push("");
  lines.push("## Email-template ticket answer contract (required)");
  lines.push(
    "This is a ticket-style ask about jobs + email templates. Structure the answer as:"
  );
  lines.push("1. **Summary** — name the open job / handler and concrete email template path(s) from evidence.");
  lines.push("2. **Your question** — answer where jobs and templates live; how to hook in.");
  lines.push(
    "3. **Jobs** — cite the open job definition and any followed handler / triggered job from `<email_template_evidence>`."
  );
  lines.push(
    "4. **Email templates** — name concrete Use-repo path(s) from the evidence block (e.g. `packages/email/templates/document-reminder.tsx`). NEVER say “search the repo for email templates” when paths are listed."
  );
  lines.push(
    "5. If the evidence block says NOT FOUND — say templates were not found after following handlers and searching email paths. Still do not invent Coop-AI local paths."
  );
  lines.push(
    "6. Cite only active Use-repo paths from evidence — never Coop-AI extension paths (`src/chat/*`, etc.)."
  );
  lines.push("");
  lines.push("PASS: name at least one concrete template path when evidence lists it.");
  lines.push('FAIL: end with only “search the repo for email templates” while evidence lists paths.');
  lines.push("");
  lines.push(formatEmailTemplateEvidenceBlock(options.resolution));
  lines.push("");
  if (options.userMessage?.trim() && options.userMessage.trim() !== options.ask.trim()) {
    lines.push("## User message");
    lines.push(options.userMessage.trim());
  }
  return lines.join("\n");
}

function isEmailTemplatePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (!/\.(tsx?|jsx?|html?)$/i.test(path)) {
    return false;
  }
  return (
    /(?:^|\/)packages\/email\/(?:templates|template-components)\//i.test(path) ||
    /(?:^|\/)email\/(?:templates|template-components)\//i.test(path) ||
    /(?:^|\/)emails?\/templates?\//i.test(path) ||
    /(?:^|\/)mail(?:er)?\/templates?\//i.test(path)
  );
}

function normalizeTemplatePath(path: string): string | undefined {
  let cleaned = normalizePosix(path.trim().replace(/^\/+/, ""));
  if (!cleaned) {
    return undefined;
  }
  if (cleaned.startsWith("email/")) {
    cleaned = `packages/${cleaned}`;
  }
  if (!/\.[a-z0-9]+$/i.test(cleaned)) {
    cleaned = `${cleaned}.tsx`;
  }
  return cleaned;
}

function rankTemplateCandidates(candidates: EmailTemplateCandidate[]): EmailTemplateCandidate[] {
  const sourceRank: Record<EmailTemplateSource, number> = {
    "followed-handler": 0,
    "package-import": 1,
    "path-literal": 2,
    "tree-match": 3
  };
  return [...candidates].sort((a, b) => {
    const src = sourceRank[a.source] - sourceRank[b.source];
    if (src !== 0) {
      return src;
    }
    const aRemind = /remind/i.test(a.path) ? 0 : 1;
    const bRemind = /remind/i.test(b.path) ? 0 : 1;
    if (aRemind !== bRemind) {
      return aRemind - bRemind;
    }
    const aExpir = /expir/i.test(a.path) ? 0 : 1;
    const bExpir = /expir/i.test(b.path) ? 0 : 1;
    if (aExpir !== bExpir) {
      return aExpir - bExpir;
    }
    return a.path.localeCompare(b.path);
  });
}

function withTsExtensions(pathWithoutExt: string): string[] {
  const base = pathWithoutExt.replace(/\.(tsx?|jsx?|mts|cts)$/i, "");
  return [`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`];
}

function dirnamePosix(filePath: string): string {
  const normalized = normalizePosix(filePath);
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "" : normalized.slice(0, idx);
}

function basenamePosix(filePath: string): string {
  const normalized = normalizePosix(filePath);
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

function normalizePosix(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}
