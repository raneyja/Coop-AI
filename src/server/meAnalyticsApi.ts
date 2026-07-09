import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import { auditActor } from "./audit/auditLogger";
import { writeJson } from "./adminApiShared";
import type { OrgApiDeps } from "./orgApi";
import { parseAnalyticsRange, productMixFromEventTypes } from "./usageTracker";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
};

export async function handleMeAnalyticsRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: OrgApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/v1/me/analytics/")) {
    return false;
  }

  const usageTracker = deps.usageTracker;
  if (!usageTracker) {
    writeJson(response, 503, { error: "usage tracking not configured" });
    return true;
  }

  const { principal } = auditActor(auth);
  const range = parseAnalyticsRange(parsed.query ?? new URLSearchParams());

  if (parsed.method === "GET" && parsed.pathname === "/v1/me/analytics/overview") {
    const [totalEvents, eventsByDay, byType] = await Promise.all([
      usageTracker.countEventsForPrincipal(auth.orgId, principal, range),
      usageTracker.eventsByDayForPrincipal(auth.orgId, principal, range),
      usageTracker.eventsByTypeForPrincipal(auth.orgId, principal, range)
    ]);
    const productMix = productMixFromEventTypes(byType);
    const suggested = byType.find((row) => row.eventType === "completion.suggested")?.count ?? 0;
    const accepted = byType.find((row) => row.eventType === "completion.accepted")?.count ?? 0;
    writeJson(response, 200, {
      totalEvents,
      eventsByDay,
      productMix,
      // Flat fields for UI fallbacks that do not read productMix object keys
      chatMessages: productMix.chat,
      quickActionCount: productMix.quickActions,
      completionEvents: productMix.completions,
      lightningEvents: productMix.lightning,
      suggested,
      accepted,
      acceptanceRate: suggested > 0 ? accepted / suggested : null
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/me/analytics/chat") {
    const byType = await usageTracker.eventsByTypeForPrincipal(auth.orgId, principal, range);
    const chatMessages = byType
      .filter((row) => row.eventType === "chat.message" || row.eventType === "chat.completion")
      .reduce((sum, row) => sum + row.count, 0);
    const quickActions = byType.filter((row) => row.eventType.startsWith("quick_action."));
    writeJson(response, 200, {
      chatMessages,
      quickActions,
      eventsByDay: await usageTracker.eventsByDayForPrincipal(auth.orgId, principal, range)
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/me/analytics/lightning") {
    const [lightningSearches, eventsByDay] = await Promise.all([
      usageTracker.countEventsOfTypeForPrincipal(auth.orgId, principal, range, "lightning.search"),
      usageTracker.eventsByDayForExactEventTypeForPrincipal(
        auth.orgId,
        principal,
        range,
        "lightning.search"
      )
    ]);
    writeJson(response, 200, {
      lightningSearches,
      searchCount: lightningSearches,
      eventsByDay
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/me/analytics/completions") {
    const byType = await usageTracker.eventsByTypeForPrincipal(auth.orgId, principal, range);
    const countFor = (eventType: string) =>
      byType.find((row) => row.eventType === eventType)?.count ?? 0;
    const suggested = countFor("completion.suggested");
    const requested = countFor("completion.requested");
    const accepted = countFor("completion.accepted");
    const rejected = countFor("completion.rejected");
    const [serverLatency, clientP50, clientP95] = await Promise.all([
      usageTracker.latencyPercentilesForPrincipal(
        auth.orgId,
        principal,
        range,
        "completion.requested",
        "latencyMs"
      ),
      usageTracker.latencyPercentilesForPrincipal(
        auth.orgId,
        principal,
        range,
        "completion.performance",
        "p50LatencyMs"
      ),
      usageTracker.latencyPercentilesForPrincipal(
        auth.orgId,
        principal,
        range,
        "completion.performance",
        "p95LatencyMs"
      )
    ]);
    writeJson(response, 200, {
      suggested,
      requested,
      accepted,
      rejected,
      acceptanceRate: suggested > 0 ? accepted / suggested : null,
      serverLatencyP50Ms: serverLatency.p50,
      serverLatencyP95Ms: serverLatency.p95,
      serverLatencySamples: serverLatency.sampleCount,
      clientLatencyP50Ms: clientP50.p50,
      clientLatencyP95Ms: clientP95.p95,
      clientLatencySamples: Math.max(clientP50.sampleCount, clientP95.sampleCount),
      eventsByDay: await usageTracker.eventsByDayForPrincipal(
        auth.orgId,
        principal,
        range,
        "completion."
      )
    });
    return true;
  }

  writeJson(response, 404, { error: "not found" });
  return true;
}
