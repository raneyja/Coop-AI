import type { AgentToolContext } from "../agentToolContext";
import { optionalStringArg } from "./toolArgs";
import {
  providerForAgentIntegrationTool,
  type AgentIntegrationToolName
} from "../integrationTools";

export async function handleIntegrationSearch(
  ctx: AgentToolContext,
  tool: AgentIntegrationToolName,
  args: Record<string, unknown>
): Promise<string> {
  const provider = providerForAgentIntegrationTool(tool);
  const query = optionalStringArg(args, "query") ?? "";
  if (!query) {
    return JSON.stringify({
      error: `${tool} requires args.query (a short ticket key, symbol, or 2–6 word phrase).`
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
    const result = await ctx.searchIntegration({ provider, query });
    return JSON.stringify(result ?? { error: `${provider} returned nothing.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${provider} search failed.`;
    return JSON.stringify({ error: message });
  }
}
