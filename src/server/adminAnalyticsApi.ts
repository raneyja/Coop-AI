import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import { parseAnalyticsRange, type UsageTracker } from "./usageTracker";
import { writeJson, type AdminApiDeps } from "./adminApiShared";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
};

export async function handleAdminAnalyticsRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext,
  usageTracker?: UsageTracker
): Promise<boolean> {
  if (!parsed.pathname.startsWith("/v1/admin/analytics/")) {
    return false;
  }

  if (!usageTracker) {
    writeJson(response, 503, { error: "usage tracking not configured" });
    return true;
  }

  const range = parseAnalyticsRange(parsed.query ?? new URLSearchParams());

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/overview") {
    const billing = deps.orgStore ? await deps.orgStore.getOrganizationBilling(auth.orgId) : undefined;
    const users = deps.userStore ? await deps.userStore.listOrgUsers(auth.orgId) : [];
    const activeUsers = users.filter((u) => !u.deactivatedAt).length;
    const seats = billing?.seatCount ?? 1;
    const [totalEvents, dau, eventsByDay] = await Promise.all([
      usageTracker.countEvents(auth.orgId, range),
      usageTracker.countDistinctPrincipals(auth.orgId, {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000),
        to: new Date()
      }),
      usageTracker.eventsByDay(auth.orgId, range)
    ]);
    const mau = await usageTracker.countDistinctPrincipals(auth.orgId, range);
    writeJson(response, 200, {
      totalUsers: users.length,
      activeUsers,
      seats,
      seatUtilization: seats > 0 ? activeUsers / seats : 0,
      dau,
      mau,
      totalEvents,
      eventsByDay
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/chat") {
    const byType = await usageTracker.eventsByType(auth.orgId, range);
    const chatMessages = byType
      .filter((row) => row.eventType === "chat.message" || row.eventType === "chat.completion")
      .reduce((sum, row) => sum + row.count, 0);
    const quickActions = byType.filter((row) => row.eventType.startsWith("quick_action."));
    const topUsers = await usageTracker.topPrincipals(auth.orgId, range);
    writeJson(response, 200, {
      chatMessages,
      quickActions,
      eventsByDay: await usageTracker.eventsByDay(auth.orgId, range),
      topUsers
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/completions") {
    const byType = await usageTracker.eventsByType(auth.orgId, range);
    const countFor = (eventType: string) =>
      byType.find((row) => row.eventType === eventType)?.count ?? 0;
    const suggested = countFor("completion.suggested");
    const accepted = countFor("completion.accepted");
    const rejected = countFor("completion.rejected");
    writeJson(response, 200, {
      suggested,
      accepted,
      rejected,
      acceptanceRate: suggested > 0 ? accepted / suggested : null,
      eventsByDay: await usageTracker.eventsByDayForEventTypes(auth.orgId, range, "completion.")
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/export.csv") {
    const csv = await usageTracker.exportCsv(auth.orgId, range);
    response.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="coop-usage-export.csv"'
    });
    response.end(csv);
    return true;
  }

  writeJson(response, 404, { error: "not found" });
  return true;
}
