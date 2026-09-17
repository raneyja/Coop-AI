import type { IntegrationChatProvider } from "../../chat/types";
import type { AgentSessionContext, AgentStep, AgentToolName } from "./agentTypes";
import { isAgentIntegrationTool, providerForAgentIntegrationTool } from "./integrationTools";
import { MAX_VENDOR_OPENS } from "../integrations/integrationHttp";

export const MAX_VENDOR_SEARCHES_PER_TOOL = 2;

const ASK_STOP = new Set([
  "about",
  "after",
  "into",
  "look",
  "looking",
  "what",
  "does",
  "did",
  "the",
  "this",
  "that",
  "with",
  "from",
  "for",
  "and",
  "say",
  "says",
  "please",
  "in",
  "on",
  "of",
  "a",
  "an",
  "to",
  "our",
  "we",
  "you",
  "me"
]);

const VENDOR_WORDS = new Set([
  "notion",
  "confluence",
  "jira",
  "slack",
  "teams",
  "microsoft",
  "google",
  "docs",
  "gdocs"
]);

export type VendorToolState = {
  searches: number;
  openAttempted: boolean;
};

const OPEN_QUERY_ID =
  /^\s*open\s+([A-Z][A-Z0-9]+-\d+|\d{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*[.!]?\s*$/i;

function coerceOpenQueryId(query: unknown): string | undefined {
  if (typeof query !== "string") {
    return undefined;
  }
  const match = query.trim().match(OPEN_QUERY_ID);
  return match?.[1];
}

export function parseOpenIds(args: Record<string, unknown>): string[] {
  const raw = args.ids ?? args.open ?? args.pageIds ?? args.issueKeys;
  const values: string[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string" && entry.trim()) {
        values.push(entry.trim());
      }
    }
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(/[,\s]+/)) {
      if (part.trim()) {
        values.push(part.trim());
      }
    }
  }
  const coerced = coerceOpenQueryId(args.query);
  if (values.length === 0 && coerced) {
    values.push(coerced);
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of values) {
    const key = id.toLowerCase();
    if (seen.has(key) || unique.length >= MAX_VENDOR_OPENS) {
      continue;
    }
    seen.add(key);
    unique.push(id);
  }
  return unique;
}

export function integrationListKey(
  payload: Record<string, unknown> | undefined
): "pages" | "documents" | "issues" | "messages" | undefined {
  if (!payload) {
    return undefined;
  }
  if (Array.isArray(payload.pages)) {
    return "pages";
  }
  if (Array.isArray(payload.documents)) {
    return "documents";
  }
  if (Array.isArray(payload.issues)) {
    return "issues";
  }
  if (Array.isArray(payload.messages)) {
    return "messages";
  }
  return undefined;
}

export function integrationHitRecords(
  payload: Record<string, unknown> | undefined
): Array<Record<string, unknown>> {
  const key = integrationListKey(payload);
  if (!key || !payload) {
    return [];
  }
  const list = payload[key];
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object"
  );
}

/** Open id for any vendor hit — key before id so Jira Opens COOP-101, not a numeric row id. */
export function integrationHitId(hit: Record<string, unknown>): string {
  for (const field of ["key", "id", "messageId", "ts"] as const) {
    const raw = hit[field];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return "";
}

function hitTitleBlob(hit: Record<string, unknown>): string {
  return `${hit.title ?? ""} ${hit.summary ?? ""} ${hit.key ?? ""}`.toLowerCase();
}

function hitTitleMatchesAsk(hit: Record<string, unknown>, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const title = hitTitleBlob(hit);
  return tokens.some((token) => title.includes(token));
}

/**
 * Choose Open ids by title vs the ask, not rank. Ceiling MAX_VENDOR_OPENS.
 * Hit 4 may Open; ranks 1–3 may be skipped. Empty hits → no Open.
 * Same picker for Slack, Teams, Jira, Confluence, Notion, and Google Docs.
 */
export function pickOpenIds(
  payload: Record<string, unknown> | undefined,
  query: string
): string[] {
  const tokens = askTopicTokens(query);
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (const hit of integrationHitRecords(payload)) {
    if (!hitTitleMatchesAsk(hit, tokens)) {
      continue;
    }
    const id = integrationHitId(hit);
    if (!id) {
      continue;
    }
    const key = id.toLowerCase();
    if (seen.has(key) || chosen.length >= MAX_VENDOR_OPENS) {
      continue;
    }
    seen.add(key);
    chosen.push(id);
  }
  return chosen;
}

function hitBody(hit: Record<string, unknown>): string {
  for (const key of ["excerpt", "description", "text", "body"] as const) {
    const value = hit[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  if (hit.threadOpened === true) {
    const text = hit.text ?? hit.body;
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }
  return "";
}

export function integrationHitsHaveBodies(payload: Record<string, unknown> | undefined): boolean {
  return integrationHitRecords(payload).some((hit) => hitBody(hit).length > 0);
}

export function askTopicTokens(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .replace(/[—–]/g, " ")
    .replace(/[^a-z0-9_./\s-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !ASK_STOP.has(token) && !VENDOR_WORDS.has(token));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    unique.push(token);
  }
  return unique.slice(0, 8);
}

export function titlesMatchAsk(payload: Record<string, unknown> | undefined, query: string): boolean {
  const hits = integrationHitRecords(payload);
  if (hits.length === 0) {
    return false;
  }
  const tokens = askTopicTokens(query);
  return hits.some((hit) => hitTitleMatchesAsk(hit, tokens));
}

export function vendorSearchNeedsRetry(options: {
  payload: Record<string, unknown> | undefined;
  query: string;
  searches: number;
}): boolean {
  if (options.searches >= MAX_VENDOR_SEARCHES_PER_TOOL) {
    return false;
  }
  const hits = integrationHitRecords(options.payload);
  if (hits.length === 0) {
    return true;
  }
  return !titlesMatchAsk(options.payload, options.query);
}

export function vendorDoneBlockReason(options: {
  query: string;
  steps: AgentStep[];
  context: AgentSessionContext | undefined;
  state: Map<AgentToolName, VendorToolState>;
  allowedRepoTools: boolean;
}): string | undefined {
  const vendorSteps = options.steps.filter((step) => isAgentIntegrationTool(step.tool));
  if (vendorSteps.length === 0) {
    return options.allowedRepoTools
      ? undefined
      : 'Search first: {"tool":"search_notion","args":{"query":"Architecture Overview"}}. Then Open chosen ids.';
  }
  for (const step of vendorSteps) {
    const tool = step.tool;
    if (!isAgentIntegrationTool(tool)) {
      continue;
    }
    const payload = options.context?.[tool];
    const toolState = options.state.get(tool) ?? { searches: 0, openAttempted: false };
    if (vendorSearchNeedsRetry({ payload, query: options.query, searches: toolState.searches })) {
      return `Search returned nothing useful. Retry ${tool} once with a nearby page title or topic — then stop if still empty. Do not Open off-topic hits.`;
    }
    const hits = integrationHitRecords(payload);
    if (hits.length > 0 && !toolState.openAttempted) {
      return `Pick up to ${MAX_VENDOR_OPENS} ids from the full hit list and Open them: {"tool":"${tool}","args":{"ids":["…"]}}. Choose by title, not rank. Hit 4 may Open; ranks 1–3 may be skipped.`;
    }
  }
  return undefined;
}

export function recordVendorToolCall(
  state: Map<AgentToolName, VendorToolState>,
  tool: AgentToolName,
  isOpen: boolean
): void {
  const prior = state.get(tool) ?? { searches: 0, openAttempted: false };
  if (isOpen) {
    state.set(tool, { ...prior, openAttempted: true });
    return;
  }
  state.set(tool, { ...prior, searches: prior.searches + 1, openAttempted: prior.openAttempted });
}

export function mergeIntegrationPayload(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): Record<string, unknown> {
  const key = integrationListKey(next) ?? integrationListKey(previous);
  if (!key) {
    return { ...(previous ?? {}), ...next };
  }
  const priorHits = integrationHitRecords(previous);
  const nextHits = integrationHitRecords(next);
  if (priorHits.length === 0) {
    return { ...(previous ?? {}), ...next };
  }
  const byId = new Map<string, Record<string, unknown>>();
  const idOf = (hit: Record<string, unknown>): string => integrationHitId(hit).toLowerCase();
  for (const hit of priorHits) {
    const id = idOf(hit);
    if (id) {
      byId.set(id, hit);
    }
  }
  for (const hit of nextHits) {
    const id = idOf(hit);
    if (id) {
      byId.set(id, { ...(byId.get(id) ?? {}), ...hit });
    }
  }
  const mergedHits = [...byId.values()];
  const leftover = nextHits.filter((hit) => !idOf(hit));
  return {
    ...(previous ?? {}),
    ...next,
    [key]: leftover.length ? [...mergedHits, ...leftover] : mergedHits
  };
}

export function vendorLabel(provider: IntegrationChatProvider): string {
  switch (provider) {
    case "google-docs":
      return "Google Docs";
    case "teams":
      return "Microsoft Teams";
    case "jira":
      return "Jira";
    case "slack":
      return "Slack";
    case "notion":
      return "Notion";
    case "confluence":
      return "Confluence";
    default:
      return provider;
  }
}

export function customerFacingVendorToolError(
  message: string,
  provider: IntegrationChatProvider
): string {
  const label = vendorLabel(provider);
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) {
    return `That ${label} search didn't finish.`;
  }
  if (
    /enforced allowlist|nothing in the allowed|not in the allowed|scope excludes|allowed scope|scope is not configured|admin must (?:select|configure)|project scope excluded|space scope excluded/i.test(
      text
    )
  ) {
    return `Nothing in the allowed ${label} matched.`;
  }
  if (/not configured|not connected|credentials not configured/i.test(text)) {
    return "That tool isn't connected.";
  }
  if (
    /\b401\b|\b403\b|unauthorized|forbidden|couldn'?t sign in|HTTP\s*401|HTTP\s*403|failed \(401\)|failed \(403\)/i.test(
      text
    )
  ) {
    return "Couldn't sign in to that tool.";
  }
  if (/stopped\.?$/i.test(text)) {
    return "Stopped.";
  }
  if (/timed out|timeout|gather budget|fetchWithTimeout|coop-response-deadline/i.test(text)) {
    return "That search didn't finish.";
  }
  if (/settings →|coop settings|oauth|env vars|stack trace/i.test(text)) {
    return `Couldn't open ${label}.`;
  }
  return text.split("\n")[0]?.slice(0, 180) || `Couldn't open ${label}.`;
}

export function toolProviderFromName(tool: string): IntegrationChatProvider | undefined {
  if (!isAgentIntegrationTool(tool)) {
    return undefined;
  }
  return providerForAgentIntegrationTool(tool);
}
