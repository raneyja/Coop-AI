import { createHash } from "node:crypto";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import type { ReviewedSourceWindow } from "../prompts/sourceCitationIntegrity";
import { splitMarkdownBlocks } from "../prompts/markdownProse";
import { SOURCE_CLAIM_REVIEW_SCHEMA } from "../prompts/sourceClaimReview";
import { tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";
import { responseTiming } from "./chatResponseTiming";
import { resolveAssignedSourceVerificationModel, SOURCE_VERIFICATION_MAX_TOKENS } from "../config/featureModelAssignments";

type Result = Awaited<ReturnType<SecureApiClient["streamChat"]>>;
const categories = ["conditions", "scope", "attribution", "operation", "impact", "unknown-premise"] as const;
export type SourceClaimIssue = { claim: string; category: typeof categories[number]; reason: string };
export type SourceClaimVerdict = { supported: boolean; issues: SourceClaimIssue[] };
export type SourceClaimRelations = { target?: string; dependents: Array<{path: string; depth: number; source: string}> };

export type SourceClaimFact = {
  kind: "inventory" | "tree" | "sample" | "dependency" | "provenance";
  /** Explicit provenance and coverage, supplied by the admitting workspace adapter. */
  scope: string;
  value: unknown;
};
export type SourceClaimBlock = { id: string; text: string; context: {id: string; text: string} | null };
type Support = { windowId: string; startLine: number; endLine: number } | { factId: string };
type Check = { blockId: string; kind: "fact" | "hypothesis" | "question" | "scope" | "unreviewed";
  decision: "supported" | "revise" | "deferred"; supports: Support[]; conditions: string; boundary: string;
  category: SourceClaimIssue["category"]; reason: string; counterexample: string;
  qualificationStatus: "none-required" | "present" | "missing" | "unreviewed";
  counterexampleStatus: "consistent" | "excluded-by-candidate" | "excluded-by-evidence" | "unresolved-contradiction" | "unreviewed";
  publicQualifications: string[] };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const maskInlineProse = (text: string) => text.replace(/(`+)[\s\S]*?\1|!?\[[^\]]*\]\([^\)\n]*\)|https?:\/\/\S+/g,
  value => value.replace(/[^\n]/g, "x"));

/** Every prose paragraph is admitted, including claim-bearing titles and questions. */
export function sourceClaimBlocks(candidate: string): SourceClaimBlock[] {
  const segmenter = new Intl.Segmenter(undefined, {granularity: "sentence"});
  let contextIndex = 0;
  return splitMarkdownBlocks(candidate).flatMap<Omit<SourceClaimBlock, "id">>(block => {
    // Quote validation precedes semantic review and normalizes verified source
    // fences to numeric locators. Anonymous formatted claims are still claims.
    if (block.kind === "code") return block.closed && tryParseFenceInfoLocator(block.info)?.startLine !== undefined
      ? [] : [{text: block.text.trim(), context: null}];
    return block.text.split(/\n\s*\n/).flatMap(paragraph => {
      // A qualifier in another list item is not a qualifier of this item's claim.
      // Inline quoted data cannot create a new prose/list context.
      const starts = [...new Set([0, ...[...maskInlineProse(paragraph)
        .matchAll(/^[ \t]*(?:[-+*][ \t]+|\d+[.)][ \t]+)/gm)].map(match => match.index)])];
      return starts.map((start, index) => paragraph.slice(start, starts[index + 1] ?? paragraph.length));
    }).map(text => text.trim()).filter(Boolean).flatMap(text => {
      const context = {id: `context-${++contextIndex}`, text};
      // Keep punctuation inside inline code and links opaque to prose segmentation.
      // Offsets stay identical, so the checked text remains the original bytes.
      const masked = maskInlineProse(text);
      return [...segmenter.segment(masked)].map(segment => text.slice(segment.index,
        segment.index + segment.segment.length).trim()).filter(Boolean).map(text => ({text, context}));
    });
  }).map((block, index) => ({ id: `block-${index + 1}`, ...block }));
}

const sameBlock = (block: SourceClaimBlock, original: SourceClaimBlock) => block.id === original.id
  && block.text === original.text && (block.context === null ? original.context === null
    : !!block.context && !!original.context && block.context.id === original.context.id && block.context.text === original.context.text);

export function snapshotSourceClaimEvidence(request: StreamChatParams, windows: ReviewedSourceWindow[],
  relations?: SourceClaimRelations, facts: SourceClaimFact[] = []) {
  const sourceWindows = windows.filter(file => typeof file.content === "string" && file.content.trim()
    && Number.isInteger(file.startLine) && Number(file.startLine) >= 1).map((file, index) => ({ id: `window-${index + 1}`,
    path: file.path, startLine: file.startLine,
    endLine: Number(file.startLine) + file.content!.split("\n").length - 1, content: file.content }));
  const records: SourceClaimFact[] = [...facts];
  for (const dependent of relations?.dependents ?? []) records.push({ kind: "dependency",
    scope: "Admitted remote file relationship only; not behavioral effect, resolved symbol, or exhaustive coverage.",
    value: { target: relations?.target, ...dependent } });
  const admittedFacts = records.map((fact, index) => ({ ...fact, id: `fact-${index + 1}` }));
  const evidence = { identity: { owner: request.context.owner, repo: request.context.repo, branch: request.context.branch, file: request.context.file },
    windows: sourceWindows, facts: admittedFacts,
    coverage: "Supplied line windows and typed scoped facts only; no unopened definitions or exhaustive repository coverage." };
  return { ...evidence, evidenceId: hash(JSON.stringify(evidence)) };
}

/** One exact line-labelled representation shared by generation and verification. */
export function sourceClaimModelWindows(windows: ReturnType<typeof snapshotSourceClaimEvidence>["windows"]) {
  return windows.map(({content, ...window}) => ({...window,
    lines: content!.split("\n").map((text, index) => ({line: Number(window.startLine) + index, text}))}));
}

export function buildSourceClaimReviewRequest(request: StreamChatParams, candidate: string,
  windows: ReviewedSourceWindow[], question?: string, relations?: SourceClaimRelations,
  facts?: SourceClaimFact[], reviewBlocks?: SourceClaimBlock[]): StreamChatParams {
  const allBlocks = sourceClaimBlocks(candidate);
  const blocks = reviewBlocks ?? allBlocks;
  if (new Set(blocks.map(block => block.id)).size !== blocks.length
    || blocks.some(block => !allBlocks.some(original => sameBlock(block, original)))) {
    throw invalidReview();
  }
  if (blocks.length > 128) throw new Error("The answer quality check cannot cover this answer. Retry with a narrower scope.");
  const evidence = snapshotSourceClaimEvidence(request, windows, relations, facts);
  return {
    ...request, sourceClaimReview: true, sourceEvidenceSynthesis: false, sourceEvidenceRepair: false,
    // Verification is an operator assignment independent of the generation pick.
    ...resolveAssignedSourceVerificationModel(), maxTokens: SOURCE_VERIFICATION_MAX_TOKENS, enableThinking: true,
    // History, attachments and the legacy context bundle are not frozen evidence.
    history: [], attachments: undefined, mentions: undefined,
    context: { owner: request.context.owner, repo: request.context.repo, branch: request.context.branch, file: request.context.file },
    message: JSON.stringify({ schema: SOURCE_CLAIM_REVIEW_SCHEMA, candidateId: hash(candidate),
      question: question ?? "Review all factual claims against the supplied source.", blocks,
      ...evidence, windows: sourceClaimModelWindows(evidence.windows) })
  };
}

const invalidReview = () => new Error("The answer quality check returned an invalid review. Retry this request.");
const conciseText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 2000;

/** Enforces exact paragraph coverage and valid provenance, not semantic proof. */
export function parseSourceClaimVerdict(result: Result, candidate: string,
  reviewRequest: StreamChatParams): SourceClaimVerdict {
  if (result.finishReason !== "stop") throw new Error("The answer quality check did not complete. Retry this request.");
  const framing = splitMarkdownBlocks(result.message.content.trim());
  const framed = framing.length === 1 && framing[0].kind === "code" && framing[0].closed && framing[0].info.toLowerCase() === "json";
  const payload = framed ? framing[0].kind === "code" ? framing[0].body : "" : result.message.content;
  let value: Record<string, unknown>;
  try { value = JSON.parse(payload); }
  catch { throw invalidReview(); }
  const evidence = JSON.parse(reviewRequest.message) as { schema: string; candidateId: string; evidenceId: string; blocks: SourceClaimBlock[];
    identity: unknown; coverage: string;
    windows: Array<{ id: string; path: string; startLine: number; endLine: number; lines: Array<{line: number; text: string}> }>;
    facts: Array<{id: string}> };
  const allBlocks = sourceClaimBlocks(candidate);
  const blocks = evidence.blocks;
  if (evidence.schema !== SOURCE_CLAIM_REVIEW_SCHEMA || !Array.isArray(blocks) || new Set(blocks.map(block => block.id)).size !== blocks.length
    || blocks.some(block => !allBlocks.some(original => sameBlock(block, original)))) throw invalidReview();
  if (!Array.isArray(evidence.windows) || !Array.isArray(evidence.facts)
    || evidence.windows.some((window, index) => !window || Object.keys(window).length !== 5
      || window.id !== `window-${index + 1}` || typeof window.path !== "string"
      || !Number.isSafeInteger(window.startLine) || window.startLine < 1
      || !Number.isSafeInteger(window.endLine) || window.endLine < window.startLine
      || !Array.isArray(window.lines) || window.lines.length !== window.endLine - window.startLine + 1
      || window.lines.some((line, offset) => !line || Object.keys(line).length !== 2
        || line.line !== window.startLine + offset || typeof line.text !== "string")
      || !window.lines.map(line => line.text).join("\n").trim())
    || evidence.facts.some((fact, index) => !fact || fact.id !== `fact-${index + 1}`)) throw invalidReview();
  const canonical = {identity: evidence.identity, windows: evidence.windows.map(window => ({id: window.id, path: window.path,
    startLine: window.startLine, endLine: window.endLine, content: window.lines.map(line => line.text).join("\n")})),
  facts: evidence.facts, coverage: evidence.coverage};
  if (hash(JSON.stringify(canonical)) !== evidence.evidenceId) throw invalidReview();
  const windowById = new Map(evidence.windows.map(window => [window.id, window]));
  const factIds = new Set(evidence.facts.map(fact => fact.id));
  const validSupport = (ref: Support) => {
    if (!ref || typeof ref !== "object") return false;
    if ("factId" in ref) return Object.keys(ref).length === 1 && typeof ref.factId === "string" && factIds.has(ref.factId);
    const window = windowById.get(ref.windowId);
    return Object.keys(ref).length === 3 && !!window && Number.isInteger(ref.startLine) && Number.isInteger(ref.endLine)
      && ref.startLine >= window.startLine && ref.endLine >= ref.startLine
      && ref.endLine <= window.endLine;
  };
  const validConsistency = (check: Check) => {
    if (!["none-required", "present", "missing", "unreviewed"].includes(check.qualificationStatus)
      || !["consistent", "excluded-by-candidate", "excluded-by-evidence", "unresolved-contradiction", "unreviewed"].includes(check.counterexampleStatus)
      || !Array.isArray(check.publicQualifications) || check.publicQualifications.length > 8) return false;
    if (check.decision === "deferred") return check.qualificationStatus === "unreviewed"
      && check.counterexampleStatus === "unreviewed" && check.publicQualifications.length === 0;
    if (check.qualificationStatus === "unreviewed" || check.counterexampleStatus === "unreviewed") return false;
    const context = blocks.find(block => block.id === check.blockId)?.context;
    if (check.qualificationStatus === "present" || check.qualificationStatus === "missing") {
      if ((check.qualificationStatus === "present" && check.publicQualifications.length === 0)
        || (check.publicQualifications.length > 0 && !context) || new Set(check.publicQualifications).size !== check.publicQualifications.length
        || !check.publicQualifications.every(quote => conciseText(quote) && /[\p{L}\p{N}]/u.test(quote) && context!.text.includes(quote))) return false;
    } else if (check.publicQualifications.length !== 0) return false;
    return (check.counterexampleStatus !== "excluded-by-candidate" || (check.publicQualifications.length > 0
      && (check.qualificationStatus === "present" || check.qualificationStatus === "missing")))
      && (check.counterexampleStatus !== "excluded-by-evidence" || check.supports.length > 0);
  };
  const valid = value && value.schema === SOURCE_CLAIM_REVIEW_SCHEMA
    && value.candidateId === hash(candidate) && value.candidateId === evidence.candidateId
    && value.evidenceId === evidence.evidenceId
    && ["supported", "revise"].includes(String(value.verdict)) && Array.isArray(value.checks)
    && value.checks.length === blocks.length
    && value.checks.every((check: Check) => check && blocks.some(block => block.id === check.blockId)
      && ["fact", "hypothesis", "question", "scope", "unreviewed"].includes(check.kind)
      && ["supported", "revise", "deferred"].includes(check.decision) && Array.isArray(check.supports)
      && check.supports.length <= 16 && check.supports.every(validSupport)
      && (check.decision === "deferred" ? check.kind === "unreviewed" && check.supports.length === 0
        : check.kind !== "unreviewed")
      && !(check.kind === "fact" && check.decision === "supported" && check.supports.length === 0)
      && conciseText(check.conditions) && conciseText(check.boundary) && conciseText(check.reason) && conciseText(check.counterexample)
      && validConsistency(check)
      && categories.includes(check.category))
    && new Set((value.checks as Check[]).map(check => check.blockId)).size === blocks.length
    && (value.verdict === "supported" ? value.checks.every((check: Check) => check.decision === "supported")
      : value.checks.some((check: Check) => check.decision === "revise"));
  if (!valid) throw invalidReview();
  // Structured admissions of a contradiction or hidden qualification cannot be
  // overridden by a supported decision, regardless of the unit's epistemic kind.
  const issues = (value.checks as Check[])
    .filter(check => check.decision === "revise" || (check.decision === "supported"
      && (check.qualificationStatus === "missing" || check.counterexampleStatus === "unresolved-contradiction")))
    .map(check => ({ claim: blocks.find(block => block.id === check.blockId)!.text,
      category: check.category, reason: check.qualificationStatus === "missing"
        ? `The review identifies a required qualification missing from the published statement. ${check.reason}`
        : check.counterexampleStatus === "unresolved-contradiction"
          ? `The review identifies an unresolved counterexample to the published statement. ${check.reason}` : check.reason }));
  return { supported: value.verdict === "supported" && issues.length === 0, issues };
}

export async function reviewSourceClaims(options: {
  request: StreamChatParams; candidate: string; windows: ReviewedSourceWindow[]; question?: string;
  relations?: SourceClaimRelations; facts?: SourceClaimFact[];
  signal?: AbortSignal; run: (request: StreamChatParams) => Promise<Result>;
}): Promise<SourceClaimVerdict> {
  options.signal?.throwIfAborted();
  const end = responseTiming(options.signal)?.span("claim-validation");
  try {
    const blocks = sourceClaimBlocks(options.candidate);
    if (blocks.length > 128) throw invalidReview();
    // Keep each adjudication bounded. The full answer remains context so earlier
    // qualifiers survive, while no claim can hide behind a long supported answer.
    // Sequential rejection avoids continuing an already invalid draft; usage is
    // recorded by the caller for every actual request, including failed reviews.
    for (let offset = 0; offset < Math.max(1, blocks.length); offset += 8) {
      options.signal?.throwIfAborted();
      const request = buildSourceClaimReviewRequest(options.request, options.candidate, options.windows,
        options.question, options.relations, options.facts, blocks.slice(offset, offset + 8));
      const result = await options.run(request);
      options.signal?.throwIfAborted();
      if (result.finishReason === "cancelled") throw new DOMException("The request was stopped.", "AbortError");
      const verdict = parseSourceClaimVerdict(result, options.candidate, request);
      if (!verdict.supported) { end?.(); return verdict; }
    }
    end?.();
    return { supported: true, issues: [] };
  } catch (error) { end?.(options.signal?.aborted ? "canceled" : "failed"); throw error; }
}
