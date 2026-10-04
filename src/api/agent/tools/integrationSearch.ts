import type { AgentToolContext } from "../agentToolContext";
import { optionalStringArg } from "./toolArgs";
import {
  providerForAgentIntegrationTool,
  type AgentIntegrationToolName
} from "../integrationTools";
import {
  customerFacingVendorToolError,
  integrationHitRecords,
  integrationHitsHaveBodies,
  parseOpenIds,
  vendorLabel
} from "../vendorLoop";
import { MAX_VENDOR_OPENS } from "../../integrations/integrationHttp";
import { googleDocumentIdFromText } from "../../googleDocs/documentUrl";

export async function handleIntegrationSearch(
  ctx: AgentToolContext,
  tool: AgentIntegrationToolName,
  args: Record<string, unknown>
): Promise<string> {
  const provider = providerForAgentIntegrationTool(tool);
  const openIds = parseOpenIds(args);
  const namedDocumentId = provider === "google-docs" && /\b(read|summari[sz]e|contents|body)\b/i.test(ctx.researchQuery ?? "")
    ? googleDocumentIdFromText(ctx.researchQuery ?? "") : undefined;
  const query = !openIds.length && namedDocumentId
    ? `https://docs.google.com/document/d/${namedDocumentId}/edit`
    : optionalStringArg(args, "query") ?? "";
  if (!query && openIds.length === 0) {
    return JSON.stringify({
      error: `${tool} requires args.query (Search) or args.ids (Open, max ${MAX_VENDOR_OPENS}).`
    });
  }
  if (!ctx.searchIntegration) {
    return JSON.stringify({
      error: `${tool} is not available in this session.`
    });
  }
  const allowed = ctx.allowedIntegrations ?? [];
  if (!allowed.includes(provider)) {
    return JSON.stringify({
      error: `${provider} is not on this turn's allowlist. Do not call ${tool}.`
    });
  }
  try {
    const result = await ctx.searchIntegration({
      provider,
      query,
      openIds: openIds.length ? openIds : undefined,
      priorHits: ctx.priorIntegrationPayload,
      signal: ctx.searchSignal
    });
    let payload = (result ?? {}) as Record<string, unknown>;
    // A named document read needs its body, not another model round selecting
    // the same unambiguous title. Keep this inside the shared gather budget.
    if (!openIds.length && !integrationHitsHaveBodies(payload) &&
        (provider === "google-docs" || provider === "notion" || provider === "confluence") &&
        /\b(read|summari[sz]e|contents|body)\b/i.test(ctx.researchQuery ?? "")) {
      const normalize = (value: string): string => value.toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const focusedTitle = normalize(query);
      const originalAsk = ` ${normalize(ctx.researchQuery ?? "")} `;
      const matches = integrationHitRecords(payload).filter((hit) => {
        const title = typeof hit.title === "string" ? normalize(hit.title) : "";
        return focusedTitle.length >= 4 && title.length >= 4 &&
          (title === focusedTitle || originalAsk.includes(` ${title} `));
      });
      if (matches.length === 1 && typeof matches[0]?.id === "string") {
        const id = matches[0].id;
        ctx.onDiagnostic?.({ stage: "integration-document-open", provider, ids: [id] });
        const opened = await ctx.searchIntegration({
          provider, query: "", openIds: [id], priorHits: payload, signal: ctx.searchSignal
        });
        payload = (opened ?? payload) as Record<string, unknown>;
      }
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      payload.error = customerFacingVendorToolError(payload.error, provider);
    }
    if (!openIds.length) {
      payload.chooseOpen =
        `Pick up to ${MAX_VENDOR_OPENS} ids by title (not rank) and call ${tool} with args.ids to Open full bodies.`;
    }
    return JSON.stringify(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${vendorLabel(provider)} search failed.`;
    return JSON.stringify({ error: customerFacingVendorToolError(message, provider) });
  }
}
