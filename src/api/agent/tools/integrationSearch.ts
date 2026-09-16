import type { AgentToolContext } from "../agentToolContext";
import { optionalStringArg } from "./toolArgs";
import {
  providerForAgentIntegrationTool,
  type AgentIntegrationToolName
} from "../integrationTools";
import {
  customerFacingVendorToolError,
  parseOpenIds,
  vendorLabel
} from "../vendorLoop";
import { MAX_VENDOR_OPENS } from "../../integrations/integrationHttp";

export async function handleIntegrationSearch(
  ctx: AgentToolContext,
  tool: AgentIntegrationToolName,
  args: Record<string, unknown>
): Promise<string> {
  const provider = providerForAgentIntegrationTool(tool);
  const openIds = parseOpenIds(args);
  const query = optionalStringArg(args, "query") ?? "";
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
    const payload = (result ?? {}) as Record<string, unknown>;
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
