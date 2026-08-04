import { isStatusTransitionIntent } from "./incidentIntent";

/**
 * Status-transition / stuck-status grounding for plain chat.
 *
 * On-call asks ("stuck PENDING", "where does status move to COMPLETED") must
 * surface (1) what keeps the entity in state, (2) the code/job that WRITES the
 * next status, and (3) honest gaps — never a throws-only answer when the open
 * file enqueues the next-state job.
 */

export type StatusTypeRole = "envelope" | "recipient" | "unknown";

export type StatusTypeMention = {
  name: string;
  role: StatusTypeRole;
  values: string[];
  line?: number;
};

export type StatusEvidenceHit = {
  line: number;
  summary: string;
  snippet: string;
};

export type StatusWritePath = {
  line: number;
  /** What is being written / advanced (e.g. DocumentStatus, SigningStatus). */
  target: string;
  /** Value or job name that advances state. */
  value: string;
  kind: "direct-write" | "job-trigger";
  jobName?: string;
  snippet: string;
  /**
   * True when this path is the best in-file evidence for advancing the
   * envelope/entity status named in the ask (e.g. COMPLETED via seal job).
   */
  advancesAskedToStatus: boolean;
};

export type StatusTransitionEvidence = {
  filePath: string;
  fromStatus?: string;
  toStatus?: string;
  statusTypes: StatusTypeMention[];
  hardAborts: StatusEvidenceHit[];
  waitingPaths: StatusEvidenceHit[];
  jobTriggers: Array<{ line: number; name: string; snippet: string }>;
  writePaths: StatusWritePath[];
  /** Honest gaps — never invent a writer that is absent from evidence. */
  gaps: string[];
};

export type FollowedStatusFile = {
  path: string;
  content: string;
};

const STATUS_TRANSITION_ASK_RE =
  /\b(?:stuck\s+(?:in\s+)?[A-Z_]{2,}|(?:where|how)\s+(?:does|do|is|can)\s+(?:\w+\s+){0,6}status\s+(?:move|change|become|transition|advance|get\s+(?:to|updated)|go)|(?:status|state)\s+(?:move|transition|change|advance)|(?:moves?|transitions?|changes?)\s+(?:to|into|from)\s+[A-Z_]{2,}|(?:from\s+)?[A-Z_]{2,}\s*(?:→|->|to)\s*[A-Z_]{2,}|(?:why\s+(?:is|are|does|do).{0,40}\b(?:pending|stuck|still)\b)|(?:waiting\s+(?:on|for|in)\s+).{0,20}\b(?:status|pending|state)\b)\b/i;

const KNOWN_STATUS_TOKEN =
  "PENDING|COMPLETED|COMPLETE|SIGNED|REJECTED|DRAFT|CANCELLED|CANCELED|FAILED|PROCESSING|ACTIVE|INACTIVE|OPEN|CLOSED|RUNNING|SUCCESS|ERROR";

const STATUS_WORD_RE = new RegExp(`\\b(${KNOWN_STATUS_TOKEN})\\b`, "gi");

const STATUS_ARROW_RE = new RegExp(
  `\\b(${KNOWN_STATUS_TOKEN})\\s*(?:→|->|to)\\s*(${KNOWN_STATUS_TOKEN})\\b`,
  "i"
);

const ENVELOPE_STATUS_TYPES = new Set([
  "documentstatus",
  "envelopestatus",
  "orderstatus",
  "jobstatus",
  "workflowstatus"
]);

const RECIPIENT_STATUS_TYPES = new Set([
  "signingstatus",
  "recipientstatus",
  "sendstatus",
  "participantstatus"
]);

/** Detect stuck-status / status-transition asks for plain chat. */
export function isStatusTransitionAsk(message: string | undefined): boolean {
  // Shared A8/A9 split — status-machine asks must not become incident-only.
  if (isStatusTransitionIntent(message)) {
    return true;
  }
  const text = message?.trim() ?? "";
  if (text.length < 8) {
    return false;
  }
  if (STATUS_TRANSITION_ASK_RE.test(text)) {
    return true;
  }
  // "customers stuck PENDING" / "envelope still PENDING"
  if (/\bstuck\b/i.test(text) && new RegExp(`\\b(${KNOWN_STATUS_TOKEN})\\b`, "i").test(text)) {
    return true;
  }
  if (/\bwhere\b/i.test(text) && /\bstatus\b/i.test(text) && /\b(complet|pend|sign|move|write|set)\w*/i.test(text)) {
    return true;
  }
  return false;
}

/** Parse from→to status tokens from the user ask when present. */
export function parseAskedStatusTransition(ask: string): { fromStatus?: string; toStatus?: string } {
  const arrow = ask.match(STATUS_ARROW_RE);
  if (arrow) {
    return {
      fromStatus: normalizeStatusToken(arrow[1]!),
      toStatus: normalizeStatusToken(arrow[2]!)
    };
  }
  const statuses = [...ask.matchAll(STATUS_WORD_RE)].map((m) => normalizeStatusToken(m[1]!));
  const unique = [...new Set(statuses)];
  if (unique.length >= 2) {
    return { fromStatus: unique[0], toStatus: unique[1] };
  }
  if (unique.length === 1) {
    const only = unique[0]!;
    if (only === "PENDING" || only === "DRAFT" || only === "PROCESSING") {
      return { fromStatus: only, toStatus: "COMPLETED" };
    }
    return { toStatus: only };
  }
  return {};
}

function normalizeStatusToken(raw: string): string {
  const upper = raw.toUpperCase();
  return upper === "COMPLETE" ? "COMPLETED" : upper;
}

/**
 * Build an index gather query that follows job triggers / status writers from
 * the open file — prefer job names over the free-form user ask alone.
 */
export function statusTransitionGatherQuery(evidence: StatusTransitionEvidence): string | undefined {
  const parts: string[] = [];
  for (const job of evidence.jobTriggers) {
    parts.push(job.name);
    const short = job.name.includes(".") ? job.name.split(".").pop() : undefined;
    if (short && short.length >= 4) {
      parts.push(short);
    }
  }
  for (const write of evidence.writePaths) {
    if (write.kind === "job-trigger" && write.jobName) {
      parts.push(write.jobName);
    }
    if (write.kind === "direct-write") {
      parts.push(`${write.target}.${write.value}`);
    }
  }
  if (evidence.toStatus) {
    parts.push(`${evidence.toStatus}`);
    // Prefer envelope status writers when both enums appear.
    if (evidence.statusTypes.some((t) => t.role === "envelope")) {
      const envelope = evidence.statusTypes.find((t) => t.role === "envelope");
      if (envelope) {
        parts.push(`${envelope.name}.${evidence.toStatus}`);
      }
    }
  }
  const unique = [...new Set(parts.map((p) => p.trim()).filter((p) => p.length >= 4))];
  if (unique.length === 0) {
    return undefined;
  }
  return unique.slice(0, 8).join(" ");
}

/** Extract status-transition evidence from open-file (and optional followed) source. */
export function extractStatusTransitionEvidence(options: {
  filePath: string;
  fileContent: string;
  ask?: string;
  followedFiles?: FollowedStatusFile[];
}): StatusTransitionEvidence {
  const asked = parseAskedStatusTransition(options.ask ?? "");
  const primary = analyzeFile(options.filePath, options.fileContent, asked);
  const followed = (options.followedFiles ?? []).map((file) =>
    analyzeFile(file.path, file.content, asked)
  );

  const mergedWritePaths = [
    ...primary.writePaths,
    ...followed.flatMap((f) =>
      f.writePaths.map((w) => ({
        ...w,
        snippet: `${w.snippet} (${f.filePath})`
      }))
    )
  ];
  const mergedJobs = [
    ...primary.jobTriggers,
    ...followed.flatMap((f) => f.jobTriggers)
  ];
  const mergedTypes = mergeStatusTypes([
    ...primary.statusTypes,
    ...followed.flatMap((f) => f.statusTypes)
  ]);

  const gaps = buildGaps({
    ...primary,
    statusTypes: mergedTypes,
    writePaths: mergedWritePaths,
    jobTriggers: mergedJobs,
    fromStatus: asked.fromStatus ?? primary.fromStatus,
    toStatus: asked.toStatus ?? primary.toStatus
  }, followed);

  return {
    filePath: options.filePath,
    fromStatus: asked.fromStatus ?? primary.fromStatus,
    toStatus: asked.toStatus ?? primary.toStatus,
    statusTypes: mergedTypes,
    hardAborts: primary.hardAborts,
    waitingPaths: primary.waitingPaths,
    jobTriggers: dedupeJobs(mergedJobs),
    writePaths: dedupeWrites(mergedWritePaths),
    gaps
  };
}

function analyzeFile(
  filePath: string,
  fileContent: string,
  asked: { fromStatus?: string; toStatus?: string }
): StatusTransitionEvidence {
  const lines = fileContent.split(/\r?\n/);
  const statusTypes = extractStatusTypes(lines);
  const jobTriggers = extractJobTriggers(lines);
  const hardAborts = extractHardAborts(lines);
  const waitingPaths = extractWaitingPaths(lines);
  const directWrites = extractDirectStatusWrites(lines, asked.toStatus);
  const writePaths: StatusWritePath[] = [
    ...directWrites,
    ...jobTriggers.map((job) => ({
      line: job.line,
      target: inferJobTarget(job.name, statusTypes, asked.toStatus),
      value: job.name,
      kind: "job-trigger" as const,
      jobName: job.name,
      snippet: job.snippet,
      advancesAskedToStatus: jobAdvancesAskedStatus(job.name, asked.toStatus)
    }))
  ];

  return {
    filePath,
    fromStatus: asked.fromStatus,
    toStatus: asked.toStatus,
    statusTypes,
    hardAborts,
    waitingPaths,
    jobTriggers,
    writePaths,
    gaps: []
  };
}

function extractStatusTypes(lines: string[]): StatusTypeMention[] {
  const byName = new Map<string, StatusTypeMention>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    for (const match of line.matchAll(/\b([A-Z][A-Za-z]+Status)\.([A-Z_]+)\b/g)) {
      const name = match[1]!;
      const value = match[2]!;
      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        if (!existing.values.includes(value)) {
          existing.values.push(value);
        }
        continue;
      }
      byName.set(key, {
        name,
        role: roleForStatusType(name),
        values: [value],
        line: lineNo
      });
    }
  }
  return [...byName.values()];
}

function roleForStatusType(name: string): StatusTypeRole {
  const key = name.toLowerCase();
  if (ENVELOPE_STATUS_TYPES.has(key) || key.endsWith("documentstatus") || key === "envelopestatus") {
    return "envelope";
  }
  if (RECIPIENT_STATUS_TYPES.has(key) || key.includes("signing") || key.includes("recipient")) {
    return "recipient";
  }
  return "unknown";
}

function extractJobTriggers(lines: string[]): Array<{ line: number; name: string; snippet: string }> {
  const hits: Array<{ line: number; name: string; snippet: string }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Prefer the line that carries name: 'job.id'
    const nameOnLine = line.match(/\bname:\s*['"`]([^'"`]+)['"`]/);
    if (nameOnLine?.[1]) {
      const name = nameOnLine[1].trim();
      const lookback = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
      const looksLikeJob =
        /triggerJob|\.trigger\(|queue\.(?:add|enqueue|publish)|jobs\./i.test(lookback) ||
        /^(?:internal|external|send|document)\./.test(name) ||
        /seal/i.test(name);
      if (looksLikeJob && name.length >= 3 && !seen.has(name) && (/[./_-]/.test(name) || /seal/i.test(name))) {
        seen.add(name);
        hits.push({
          line: i + 1,
          name,
          snippet: line.trim().slice(0, 160)
        });
        continue;
      }
    }

    const window = lines.slice(i, Math.min(lines.length, i + 6)).join("\n");
    const patterns = [
      /(?:jobs\.triggerJob|triggerJob)\(\s*\{[\s\S]*?name:\s*['"`]([^'"`]+)['"`]/,
      /\.trigger(?:Job)?\(\s*['"`]([^'"`]+)['"`]/,
      /(?:queue)\.(?:add|enqueue|publish)\(\s*['"`]([^'"`]+)['"`]/
    ];
    for (const pattern of patterns) {
      const match = window.match(pattern);
      if (!match?.[1]) {
        continue;
      }
      const name = match[1].trim();
      if (name.length < 3 || seen.has(name)) {
        continue;
      }
      if (!/[./_-]/.test(name) && !/^(seal|send|document|internal)/i.test(name)) {
        continue;
      }
      seen.add(name);
      // Prefer the name: line inside the window when present.
      let nameLine = i + 1;
      for (let j = i; j < Math.min(lines.length, i + 6); j++) {
        if (lines[j]!.includes(`'${name}'`) || lines[j]!.includes(`"${name}"`) || lines[j]!.includes(`\`${name}\``)) {
          nameLine = j + 1;
          break;
        }
      }
      hits.push({
        line: nameLine,
        name,
        snippet: lines[nameLine - 1]!.trim().slice(0, 160)
      });
    }
  }
  return hits;
}

function extractHardAborts(lines: string[]): StatusEvidenceHit[] {
  const hits: StatusEvidenceHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/\bthrow\s+new\b/.test(line) && !/\bthrow\s+[A-Za-z_]/.test(line)) {
      continue;
    }
    const contextStart = Math.max(0, i - 4);
    const context = lines.slice(contextStart, i + 1).join("\n");
    // Skip throws that are clearly "not our turn / already done" waiting semantics —
    // those still abort *this attempt*, so they stay hard-aborts, but summarize clearly.
    const summary = summarizeAbort(context, line);
    hits.push({
      line: i + 1,
      summary,
      snippet: line.trim().slice(0, 160)
    });
  }
  return hits.slice(0, 24);
}

function summarizeAbort(context: string, throwLine: string): string {
  if (/already signed/i.test(context) || /SigningStatus\.SIGNED/i.test(context)) {
    return "Abort: recipient already SIGNED (recipient SigningStatus — not envelope COMPLETED)";
  }
  if (/already rejected|SigningStatus\.REJECTED/i.test(context)) {
    return "Abort: recipient already REJECTED";
  }
  if (/must be pending|DocumentStatus\.PENDING/i.test(context) && /status\s*!==|!==\s*.*PENDING/i.test(context)) {
    return "Abort: envelope DocumentStatus must be PENDING for this completion attempt";
  }
  if (/before it was their turn|not.*turn/i.test(context)) {
    return "Abort: sequential signing — not this recipient's turn yet";
  }
  if (/2FA|TWO_FACTOR|unauthorized|authentication/i.test(context)) {
    return "Abort: access auth / 2FA failed for this completion attempt";
  }
  if (/unsigned|required field/i.test(context)) {
    return "Abort: required fields still unsigned for this recipient";
  }
  const msg = throwLine.match(/['"`]([^'"`]{8,120})['"`]/);
  return msg ? `Abort: ${msg[1]}` : "Abort: hard error throws and stops this completion attempt";
}

function extractWaitingPaths(lines: string[]): StatusEvidenceHit[] {
  const hits: StatusEvidenceHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    if (/pendingRecipients\.length\s*>\s*0/.test(line) || /pendingRecipients\.length\s*>\s*0/.test(lines.slice(i, i + 3).join("\n"))) {
      hits.push({
        line: lineNo,
        summary:
          "Waiting: other recipients still unsigned — envelope DocumentStatus stays PENDING (not a hard failure)",
        snippet: line.trim().slice(0, 160)
      });
      continue;
    }
    if (/haveAllRecipientsSigned/.test(line) && /if\s*\(/.test(line)) {
      hits.push({
        line: lineNo,
        summary:
          "Gate: seal / COMPLETED path only runs when every non-CC recipient is SIGNED — otherwise envelope stays PENDING",
        snippet: line.trim().slice(0, 160)
      });
      continue;
    }
    if (/send\.document\.pending\.email|document\.pending/.test(line)) {
      hits.push({
        line: lineNo,
        summary: "Waiting path: notify next / pending signer — DocumentStatus remains PENDING",
        snippet: line.trim().slice(0, 160)
      });
    }
  }
  return dedupeHits(hits);
}

function extractDirectStatusWrites(
  lines: string[],
  toStatus?: string
): StatusWritePath[] {
  const writes: StatusWritePath[] = [];
  /** Locals assigned from Enum.VALUE — resolve `status: finalEnvelopeStatus`. */
  const aliasToValue = new Map<string, { target: string; value: string; line: number }>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const match of line.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Z_]+)\b/g
    )) {
      aliasToValue.set(match[1]!, {
        target: match[2]!,
        value: match[3]!,
        line: i + 1
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    // prisma/update style: status: DocumentStatus.COMPLETED or status: finalEnvelopeStatus
    for (const match of line.matchAll(
      /\b(status|signingStatus|envelopeStatus|documentStatus)\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)/g
    )) {
      const field = match[1]!;
      const valueExpr = match[2]!;
      const window = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 2)).join("\n");
      const inDataBlock = /\bdata\s*:\s*\{/.test(window);
      // Skip filter/where reads — only count assignments under data: / update / create.
      if (!inDataBlock && !/\.(?:update|create|updateMany)\s*\(/.test(window)) {
        continue;
      }
      // If the nearest brace context is where: without data:, skip.
      const dataIdx = window.lastIndexOf("data:");
      const whereIdx = window.lastIndexOf("where:");
      if (whereIdx > dataIdx && !inDataBlock) {
        continue;
      }
      let target: string;
      let value: string;
      if (valueExpr.includes(".")) {
        target = valueExpr.split(".")[0]!;
        value = valueExpr.split(".").pop()!;
      } else if (aliasToValue.has(valueExpr)) {
        const alias = aliasToValue.get(valueExpr)!;
        target = alias.target;
        value = alias.value;
      } else {
        target = field === "signingStatus" ? "SigningStatus" : "status";
        value = valueExpr.replace(/['"]/g, "");
      }
      const normalizedValue = normalizeStatusToken(value);
      const wanted = toStatus ? normalizeStatusToken(toStatus) : undefined;
      const advances =
        Boolean(wanted) &&
        normalizedValue === wanted &&
        field !== "signingStatus" &&
        roleForStatusType(target) !== "recipient";
      writes.push({
        line: lineNo,
        target,
        value: normalizedValue,
        kind: "direct-write",
        snippet: line.trim().slice(0, 160),
        advancesAskedToStatus: advances
      });
    }
  }
  return writes;
}

function jobAdvancesAskedStatus(
  jobName: string,
  toStatus: string | undefined
): boolean {
  const lower = jobName.toLowerCase();
  const sealLike = /seal/.test(lower) || /finalize/.test(lower);
  const completeLike = /complete/.test(lower) && !/recipient/.test(lower);
  if (!toStatus) {
    return sealLike || completeLike;
  }
  const wanted = normalizeStatusToken(toStatus);
  if (wanted === "COMPLETED") {
    // Seal / finalize jobs are the COMPLETED writer path when triggered after all signers.
    return sealLike || completeLike;
  }
  return false;
}

function inferJobTarget(
  jobName: string,
  types: StatusTypeMention[],
  toStatus?: string
): string {
  if (/seal/i.test(jobName) || (toStatus && /complete/i.test(toStatus))) {
    const envelope = types.find((t) => t.role === "envelope");
    return envelope?.name ?? "DocumentStatus";
  }
  if (/recipient|sign/i.test(jobName)) {
    const recipient = types.find((t) => t.role === "recipient");
    return recipient?.name ?? "SigningStatus";
  }
  return "status";
}

function buildGaps(
  evidence: StatusTransitionEvidence,
  followed: StatusTransitionEvidence[]
): string[] {
  const gaps: string[] = [];
  const toStatus = evidence.toStatus?.toUpperCase();
  const hasAdvancingWrite = evidence.writePaths.some((w) => w.advancesAskedToStatus);
  const hasDirectToStatus = evidence.writePaths.some(
    (w) =>
      w.kind === "direct-write" &&
      toStatus &&
      w.value.toUpperCase() === toStatus
  );
  const sealJob = evidence.jobTriggers.find((j) => /seal/i.test(j.name));

  if (toStatus && !hasAdvancingWrite && !hasDirectToStatus) {
    gaps.push(
      `No in-file write of ${toStatus} was found — do not claim this file assigns that status.`
    );
  }
  if (sealJob && toStatus && (toStatus === "COMPLETED" || toStatus === "COMPLETE") && !hasDirectToStatus) {
    const followedHasDirect = followed.some((f) =>
      f.writePaths.some(
        (w) => w.kind === "direct-write" && w.value.toUpperCase() === toStatus
      )
    );
    if (!followedHasDirect) {
      gaps.push(
        `\`${sealJob.name}\` is triggered here; the actual \`${toStatus}\` assignment likely lives in that job handler — cite the trigger from this file, and only cite a handler write when that file is in evidence.`
      );
    }
  }
  if (evidence.statusTypes.some((t) => t.role === "envelope") && evidence.statusTypes.some((t) => t.role === "recipient")) {
    gaps.push(
      "Do not conflate recipient SigningStatus with envelope DocumentStatus — say which enum each claim refers to."
    );
  }
  if (evidence.hardAborts.length > 0 && evidence.writePaths.filter((w) => w.advancesAskedToStatus).length === 0 && !sealJob) {
    gaps.push(
      "Evidence lists completion aborts but no next-status write path — say the COMPLETED writer was not found in attached evidence."
    );
  }
  return [...new Set(gaps)];
}

function mergeStatusTypes(types: StatusTypeMention[]): StatusTypeMention[] {
  const byName = new Map<string, StatusTypeMention>();
  for (const type of types) {
    const key = type.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...type, values: [...type.values] });
      continue;
    }
    for (const value of type.values) {
      if (!existing.values.includes(value)) {
        existing.values.push(value);
      }
    }
  }
  return [...byName.values()];
}

function dedupeJobs(
  jobs: Array<{ line: number; name: string; snippet: string }>
): Array<{ line: number; name: string; snippet: string }> {
  const seen = new Set<string>();
  const out: typeof jobs = [];
  for (const job of jobs) {
    if (seen.has(job.name)) {
      continue;
    }
    seen.add(job.name);
    out.push(job);
  }
  return out;
}

function dedupeWrites(writes: StatusWritePath[]): StatusWritePath[] {
  const seen = new Set<string>();
  const out: StatusWritePath[] = [];
  for (const write of writes) {
    const key = `${write.kind}:${write.jobName ?? write.value}:${write.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(write);
  }
  return out;
}

function dedupeHits(hits: StatusEvidenceHit[]): StatusEvidenceHit[] {
  const seen = new Set<string>();
  const out: StatusEvidenceHit[] = [];
  for (const hit of hits) {
    const key = hit.summary;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/**
 * Shape extracted evidence into the model-facing status-transition contract.
 * Unit tests assert this text — not free-form LLM output.
 */
export function formatStatusTransitionEvidenceBlock(evidence: StatusTransitionEvidence): string {
  const lines: string[] = [];
  lines.push("<status_transition_evidence>");
  lines.push(`open_file: ${evidence.filePath}`);
  if (evidence.fromStatus || evidence.toStatus) {
    lines.push(
      `asked_transition: ${evidence.fromStatus ?? "?"}${evidence.toStatus ? ` → ${evidence.toStatus}` : ""}`
    );
  }
  lines.push("");

  lines.push("## Status type distinction (required when both appear)");
  if (evidence.statusTypes.length === 0) {
    lines.push("- No DocumentStatus / SigningStatus-style enums detected in attached evidence.");
  } else {
    for (const type of evidence.statusTypes) {
      const role =
        type.role === "envelope"
          ? "envelope/entity status"
          : type.role === "recipient"
            ? "recipient/participant status"
            : "status enum";
      lines.push(
        `- \`${type.name}\` (${role})${type.values.length ? `: ${type.values.join(", ")}` : ""}`
      );
    }
    if (
      evidence.statusTypes.some((t) => t.role === "envelope") &&
      evidence.statusTypes.some((t) => t.role === "recipient")
    ) {
      lines.push(
        "- PASS: say which enum each claim uses. FAIL: treat recipient SIGNED as envelope COMPLETED."
      );
    }
  }
  lines.push("");

  lines.push("## What keeps it in the current state");
  if (evidence.waitingPaths.length === 0 && evidence.hardAborts.length === 0) {
    lines.push("- Not identified from open-file guards — do not invent retention conditions.");
  } else {
    for (const hit of evidence.waitingPaths) {
      lines.push(`- L${hit.line}: ${hit.summary}`);
      lines.push(`  \`${hit.snippet}\``);
    }
    if (evidence.fromStatus) {
      lines.push(
        `- Envelope/entity can remain \`${evidence.fromStatus}\` while waiting paths above apply — that is legitimate PENDING, not necessarily an error.`
      );
    }
  }
  lines.push("");

  lines.push("## Hard errors that abort THIS completion attempt");
  if (evidence.hardAborts.length === 0) {
    lines.push("- None extracted from throws in the open file.");
  } else {
    for (const hit of evidence.hardAborts.slice(0, 12)) {
      lines.push(`- L${hit.line}: ${hit.summary}`);
      lines.push(`  \`${hit.snippet}\``);
    }
  }
  lines.push(
    "- These aborts stop the current attempt; they are not the same as “still waiting on the next signer.”"
  );
  lines.push("");

  lines.push("## Next-status WRITE path (required — never invent)");
  const advancing = evidence.writePaths.filter((w) => w.advancesAskedToStatus);
  const otherWrites = evidence.writePaths.filter((w) => !w.advancesAskedToStatus);
  if (advancing.length === 0 && otherWrites.length === 0) {
    lines.push(
      "- No status write or job trigger that advances the asked status was found in evidence. Say so plainly."
    );
  } else {
    for (const write of advancing) {
      if (write.kind === "job-trigger") {
        lines.push(
          `- L${write.line}: job \`${write.jobName}\` — WRITE PATH that advances toward ${evidence.toStatus ?? "next status"} (triggered from \`${evidence.filePath}\`; cite this symbol/path).`
        );
      } else {
        lines.push(
          `- L${write.line}: direct write \`${write.target}.${write.value}\` in \`${evidence.filePath}\`.`
        );
      }
      lines.push(`  \`${write.snippet}\``);
    }
    for (const write of otherWrites.slice(0, 8)) {
      if (write.kind === "job-trigger") {
        lines.push(
          `- L${write.line}: related job \`${write.jobName}\` (not claimed as the ${evidence.toStatus ?? "next-status"} writer unless evidence shows it).`
        );
      } else {
        lines.push(
          `- L${write.line}: in-file update \`${write.target}.${write.value}\` (recipient/local field — not necessarily envelope ${evidence.toStatus ?? "next status"}).`
        );
      }
    }
  }
  lines.push("");

  lines.push("## Honest gaps");
  if (evidence.gaps.length === 0) {
    lines.push("- None beyond the evidence above.");
  } else {
    for (const gap of evidence.gaps) {
      lines.push(`- ${gap}`);
    }
  }
  lines.push("</status_transition_evidence>");
  return lines.join("\n");
}

/** Full user-prompt shaping for status-transition plain chat. */
export function buildStatusTransitionSynthesisUserPrompt(options: {
  ask: string;
  evidence: StatusTransitionEvidence;
  /** Original user message / task text (kept after the evidence block). */
  userMessage?: string;
}): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(
    options.ask.trim() ||
      "Explain what keeps this entity in its current status and which code/job writes the next status."
  );
  lines.push("");
  lines.push("## Status-transition answer contract (required)");
  lines.push(
    "This is an on-call stuck-status / status-transition question. Structure the answer as:"
  );
  lines.push("1. **Summary** — name the next-status WRITE path first when evidence has one (job or direct write).");
  lines.push("2. **Your question** — answer the ask with the write path + what keeps it pending.");
  lines.push("3. **What keeps it in state** — waiting paths (still legitimately PENDING) vs hard aborts.");
  lines.push("4. **Hard errors that abort this attempt** — throws that stop completion now.");
  lines.push(
    "5. **Next-status write path** — cite the job/symbol/file that advances status (e.g. `internal.seal-document`). Never invent a writer absent from `<status_transition_evidence>`."
  );
  lines.push("6. **Status type distinction** — when both appear, separate recipient SigningStatus from envelope DocumentStatus.");
  lines.push("7. **Gaps** — say what evidence does not show.");
  lines.push("");
  lines.push("PASS: name the seal/job/writer when the evidence block lists it.");
  lines.push("FAIL: only list throw conditions while omitting an evidenced job trigger that advances status.");
  lines.push("FAIL: claim COMPLETED was written in-file when only throws (no write/job) are evidenced.");
  lines.push("");
  lines.push(formatStatusTransitionEvidenceBlock(options.evidence));
  lines.push("");
  if (options.userMessage?.trim() && options.userMessage.trim() !== options.ask.trim()) {
    lines.push("## User message");
    lines.push(options.userMessage.trim());
  }
  return lines.join("\n");
}

/** Test helper: shaped output must mention this write path string when evidence includes it. */
export function shapedEvidenceMentionsWritePath(
  shaped: string,
  writePath: string
): boolean {
  return shaped.includes(writePath);
}

/** Test helper: shaped output must NOT claim an in-file COMPLETED write when absent. */
export function shapedEvidenceClaimsInFileCompletedWrite(shaped: string): boolean {
  return /direct write\s+`[^`]*COMPLETED`/i.test(shaped) || /assigns?\s+`?COMPLETED`?\s+in-file/i.test(shaped);
}
