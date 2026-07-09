import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import { principalForUser } from "./audit/auditLogger";
import {
  parseAnalyticsRange,
  productMixFromEventTypes,
  type UsageTracker
} from "./usageTracker";
import { writeJson, type AdminApiDeps } from "./adminApiShared";

type ParsedRequest = {
  method: string;
  pathname: string;
  query?: URLSearchParams;
};

async function buildInactiveUsers(
  usageTracker: UsageTracker,
  orgId: string,
  range: ReturnType<typeof parseAnalyticsRange>,
  users: Array<{ id: string; email: string; deactivatedAt?: Date }>
): Promise<
  Array<{
    userId: string;
    email: string;
    principal: string;
    lastActiveAt: string | null;
  }>
> {
  const [activePrincipals, lastActiveRows] = await Promise.all([
    usageTracker.listActivePrincipals(orgId, range),
    usageTracker.lastActiveAtByPrincipal(orgId)
  ]);
  const activePrincipalSet = new Set(activePrincipals);
  const lastActiveByPrincipal = new Map(
    lastActiveRows.map((row) => [row.principal, row.lastActiveAt] as const)
  );
  return users
    .filter((user) => !user.deactivatedAt)
    .filter((user) => !activePrincipalSet.has(principalForUser(user.id)))
    .map((user) => {
      const principal = principalForUser(user.id);
      const lastActiveAt = lastActiveByPrincipal.get(principal);
      return {
        userId: user.id,
        email: user.email,
        principal,
        lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null
      };
    });
}

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
    const [totalEvents, dau, eventsByDay, byType, inactiveUsers] = await Promise.all([
      usageTracker.countEvents(auth.orgId, range),
      usageTracker.countDistinctPrincipals(auth.orgId, {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000),
        to: new Date()
      }),
      usageTracker.eventsByDay(auth.orgId, range),
      usageTracker.eventsByType(auth.orgId, range),
      buildInactiveUsers(usageTracker, auth.orgId, range, users)
    ]);
    const mau = await usageTracker.countDistinctPrincipals(auth.orgId, range);
    const productMix = productMixFromEventTypes(byType);
    const suggested = byType.find((row) => row.eventType === "completion.suggested")?.count ?? 0;
    const accepted = byType.find((row) => row.eventType === "completion.accepted")?.count ?? 0;
    writeJson(response, 200, {
      totalUsers: users.length,
      activeUsers,
      seats,
      seatUtilization: seats > 0 ? activeUsers / seats : 0,
      dau,
      mau,
      totalEvents,
      eventsByDay,
      productMix,
      acceptanceRate: suggested > 0 ? accepted / suggested : null,
      inactiveSeatCount: inactiveUsers.length,
      // Alias for UI stubs that expect a count named inactiveSeats
      inactiveSeats: inactiveUsers.length,
      inactiveUsers
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/chat") {
    const byType = await usageTracker.eventsByType(auth.orgId, range);
    const chatMessages = byType
      .filter((row) => row.eventType === "chat.message" || row.eventType === "chat.completion")
      .reduce((sum, row) => sum + row.count, 0);
    const quickActions = byType.filter((row) => row.eventType.startsWith("quick_action."));
    const [topUsers, carByPrincipal] = await Promise.all([
      usageTracker.topPrincipals(auth.orgId, range),
      usageTracker.completionAcceptanceByPrincipal(auth.orgId, range)
    ]);
    const carByPrincipalMap = new Map(carByPrincipal.map((row) => [row.principal, row] as const));
    const topUsersWithCar = topUsers.map((user) => {
      const car = carByPrincipalMap.get(user.principal);
      return {
        ...user,
        suggested: car?.suggested ?? 0,
        accepted: car?.accepted ?? 0,
        acceptanceRate: car?.acceptanceRate ?? null
      };
    });
    writeJson(response, 200, {
      chatMessages,
      quickActions,
      eventsByDay: await usageTracker.eventsByDay(auth.orgId, range),
      topUsers: topUsersWithCar
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/lightning") {
    const [lightningSearches, eventsByDay] = await Promise.all([
      usageTracker.countEventsOfType(auth.orgId, range, "lightning.search"),
      usageTracker.eventsByDayForExactEventType(auth.orgId, range, "lightning.search")
    ]);
    writeJson(response, 200, {
      lightningSearches,
      // Alias for UI stubs that expect searchCount
      searchCount: lightningSearches,
      eventsByDay
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/completions") {
    const byType = await usageTracker.eventsByType(auth.orgId, range);
    const countFor = (eventType: string) =>
      byType.find((row) => row.eventType === eventType)?.count ?? 0;
    const suggested = countFor("completion.suggested");
    const requested = countFor("completion.requested");
    const accepted = countFor("completion.accepted");
    const rejected = countFor("completion.rejected");
    const [serverLatency, clientP50, clientP95, topUsersByCar] = await Promise.all([
      usageTracker.latencyPercentilesForEventType(auth.orgId, range, "completion.requested", "latencyMs"),
      usageTracker.latencyPercentilesForEventType(auth.orgId, range, "completion.performance", "p50LatencyMs"),
      usageTracker.latencyPercentilesForEventType(auth.orgId, range, "completion.performance", "p95LatencyMs"),
      usageTracker.completionAcceptanceByPrincipal(auth.orgId, range)
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
      eventsByDay: await usageTracker.eventsByDayForEventTypes(auth.orgId, range, "completion."),
      topUsersByCar
    });
    return true;
  }

  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/analytics/users") {
    const users = deps.userStore ? await deps.userStore.listOrgUsers(auth.orgId) : [];
    const [topUsers, carByPrincipal, lastActiveRows, inactiveUsers] = await Promise.all([
      usageTracker.topPrincipals(auth.orgId, range, 100),
      usageTracker.completionAcceptanceByPrincipal(auth.orgId, range, 100),
      usageTracker.lastActiveAtByPrincipal(auth.orgId),
      buildInactiveUsers(usageTracker, auth.orgId, range, users)
    ]);
    const emailByPrincipal = new Map(
      users.map((user) => [principalForUser(user.id), user.email] as const)
    );
    const carByPrincipalMap = new Map(carByPrincipal.map((row) => [row.principal, row] as const));
    const lastActiveByPrincipal = new Map(
      lastActiveRows.map((row) => [row.principal, row.lastActiveAt] as const)
    );
    const activityUsers = topUsers.map((row) => {
      const car = carByPrincipalMap.get(row.principal);
      const lastActiveAt = lastActiveByPrincipal.get(row.principal);
      return {
        principal: row.principal,
        email: emailByPrincipal.get(row.principal),
        eventCount: row.count,
        suggested: car?.suggested ?? 0,
        accepted: car?.accepted ?? 0,
        acceptanceRate: car?.acceptanceRate ?? null,
        lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null
      };
    });
    writeJson(response, 200, {
      inactiveSeatCount: inactiveUsers.length,
      inactiveSeats: inactiveUsers.length,
      inactiveUsers,
      users: activityUsers
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
