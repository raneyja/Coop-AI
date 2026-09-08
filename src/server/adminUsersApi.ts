import type { ServerResponse } from "node:http";
import { auditActor } from "./audit/auditLogger";
import { requireTeamPlan } from "./planGates";
import { loadBillingConfig } from "./billing/billingConfig";
import { adminPortalAcceptInviteUrl } from "./billing/adminPortalUrl";
import { EmailService } from "./email/emailService";
import type { AuthContext } from "./orgStore";
import type { UserRole } from "./users/userStore";
import { normalizeUserRole } from "./users/userStore";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import { resolveEffectiveSeatCount } from "./billing/resolveSeatCount";
import { getDbPool } from "./db";
import { UserRepoGrantStore } from "./userRepoGrantStore";
import { indexedOrgRepoIds } from "./resolveAccessibleRepos";
import { convertMemberUsageTier, mapStripeConvertError, SeatConvertError } from "./billing/convertSeat";
import { SeatUpgradeRequestStore } from "./billing/seatUpgradeRequestStore";
import { StripeService } from "./billing/stripeService";
import { neverFilledSeats, displaySeatMix, isMixedSeatInventory, seatInventoryTotal } from "./billing/seatInventory";
import { namedSeatStatus } from "./billing/seatOccupancy";
import { parseUsageTier, displayUsageTierName, seatPricesUsd, type UsageTier } from "./usageTiers";
import { resolveInviteTarget, isInviteUserConflictError } from "./users/inviteOrgUser";

type ParsedRequest = {
  method: string;
  pathname: string;
  body: unknown;
};

const USER_ROLES = new Set<UserRole>(["admin", "member"]);

export async function handleAdminUsersRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (parsed.method === "GET" && parsed.pathname === "/v1/admin/users") {
    if (!deps.userStore) {
      writeJson(response, 503, { error: "user store not configured" });
      return true;
    }
    const users = await deps.userStore.listOrgUsers(auth.orgId);
    const billing = deps.orgStore ? await deps.orgStore.getOrganizationBilling(auth.orgId) : undefined;
    const occupied = await deps.userStore.countOccupiedSeatsByTier(auth.orgId);
    const purchased = billing?.seatInventory ?? occupied;
    const neverFilled = neverFilledSeats(purchased, occupied);
    const seats = deps.orgStore
      ? Math.max(
          await resolveEffectiveSeatCount(deps.orgStore, auth.orgId, billing),
          seatInventoryTotal(purchased)
        )
      : Math.max(1, seatInventoryTotal(purchased) || Math.floor(Number(billing?.seatCount ?? 1) || 1));
    const seatsUsed = seatInventoryTotal(occupied);
    let pendingRequests: Array<Record<string, unknown>> = [];
    try {
      const pool = await getDbPool();
      if (pool) {
        const requestStore = new SeatUpgradeRequestStore(pool);
        const pending = await requestStore.listPendingForOrg(auth.orgId);
        pendingRequests = pending.map((request) => ({
          id: request.id,
          userId: request.userId,
          fromTier: request.fromTier,
          toTier: request.toTier,
          createdAt: request.createdAt
        }));
      }
    } catch {
      pendingRequests = [];
    }
    writeJson(response, 200, {
      users: users.map(toUserSummary),
      seats,
      seatsUsed,
      seatInventory: purchased,
      occupiedSeats: occupied,
      neverFilledSeats: neverFilled,
      seatMix: displaySeatMix(purchased),
      mixedSeats: isMixedSeatInventory(purchased),
      seatPrices: seatPricesUsd(),
      pendingUpgradeRequests: pendingRequests
    });
    return true;
  }

  if (parsed.method === "POST" && parsed.pathname === "/v1/admin/users/invite") {
    if (!deps.userStore) {
      writeJson(response, 503, { error: "user store not configured" });
      return true;
    }
    if (!(await requireTeamPlan(deps.orgStore, auth, response))) {
      return true;
    }
    const body = asRecord(parsed.body);
    const email = String(body.email ?? "").trim();
    const role = String(body.role ?? "member").toLowerCase() as UserRole;
    const rawRepoIds = body.repoIds;
    const inviteRepoIds = Array.isArray(rawRepoIds)
      ? rawRepoIds.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
    if (!email) {
      writeJson(response, 400, { error: "email is required" });
      return true;
    }
    if (!USER_ROLES.has(role)) {
      writeJson(response, 400, { error: "role must be admin or member" });
      return true;
    }
    const billing = deps.orgStore ? await deps.orgStore.getOrganizationBilling(auth.orgId) : undefined;
    const inviteTier =
      parseUsageTier(typeof body.usageTier === "string" ? body.usageTier : "") ??
      billing?.usageTier ??
      "pro";
    if (deps.orgStore) {
      const occupied = await deps.userStore.countOccupiedSeatsByTier(auth.orgId);
      const purchased = billing?.seatInventory ?? occupied;
      const neverFilled = neverFilledSeats(purchased, occupied);
      if (neverFilled[inviteTier] < 1) {
        writeJson(response, 403, {
          error: "seat_limit_reached",
          message: `No unused ${displayUsageTierName(inviteTier)} seat is available to invite into. Buy another seat from Billing first.`,
          seats: seatInventoryTotal(purchased),
          used: seatInventoryTotal(occupied),
          usageTier: inviteTier
        });
        return true;
      }
    }
    let user;
    try {
      user = await resolveInviteTarget(deps.userStore, {
        orgId: auth.orgId,
        email,
        role,
        usageTier: inviteTier
      });
    } catch (error) {
      if (isInviteUserConflictError(error)) {
        writeJson(response, 409, { error: error.code, message: error.message });
        return true;
      }
      throw error;
    }
    if (deps.authTokenStore) {
      await deps.authTokenStore.revokeUnusedTokens(user.id, "user_invite");
    }
    await audit(deps, auth, "admin.user.invite", { userId: user.id, email: user.email, role });

    const org = await deps.orgStore!.getOrganization(auth.orgId);
    if (org?.repoAccessMode === "per_user" && inviteRepoIds.length > 0) {
      try {
        await setUserRepoGrantsForOrg(deps, auth.orgId, user.id, inviteRepoIds);
        await audit(deps, auth, "admin.user.repo_grants.set", {
          userId: user.id,
          count: inviteRepoIds.length
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to set repo grants.";
        writeJson(response, 400, { error: "repo_grants_invalid", message });
        return true;
      }
    }

    const billingConfig = loadBillingConfig();
    const emailService = new EmailService(billingConfig);
    try {
      if (!deps.authTokenStore) {
        throw new Error("auth token store not configured");
      }
      const orgName = org?.name ?? "your organization";
      const inviteToken = await deps.authTokenStore.createToken(
        user.id,
        "user_invite",
        7 * 24 * 60 * 60 * 1000,
        { orgName, invitedBy: auth.email }
      );
      await emailService.sendInvite({
        to: email,
        orgName,
        acceptInviteUrl: adminPortalAcceptInviteUrl(billingConfig.adminPortalUrl, inviteToken),
        invitedBy: auth.email
      });
    } catch (error) {
      console.warn("[invite] email failed:", error);
    }

    writeJson(response, 201, {
      user: toUserSummary(user),
      inviteStatus: "created"
    });
    return true;
  }

  const convertMatch = parsed.pathname.match(/^\/v1\/admin\/users\/([^/]+)\/usage-tier$/);
  if (convertMatch && parsed.method === "POST") {
    return handleConvertUserTier(decodeURIComponent(convertMatch[1]), parsed, response, deps, auth);
  }

  const confirmMatch = parsed.pathname.match(/^\/v1\/admin\/seat-upgrade-requests\/([^/]+)\/confirm$/);
  if (confirmMatch && parsed.method === "POST") {
    return handleResolveUpgradeRequest(decodeURIComponent(confirmMatch[1]), "confirmed", response, deps, auth);
  }

  const denyMatch = parsed.pathname.match(/^\/v1\/admin\/seat-upgrade-requests\/([^/]+)\/deny$/);
  if (denyMatch && parsed.method === "POST") {
    return handleResolveUpgradeRequest(decodeURIComponent(denyMatch[1]), "denied", response, deps, auth);
  }

  const patchMatch = parsed.pathname.match(/^\/v1\/admin\/users\/([^/]+)$/);
  if (patchMatch && parsed.method === "PATCH") {
    return handlePatchUser(decodeURIComponent(patchMatch[1]), parsed, response, deps, auth);
  }

  const repoGrantsMatch = parsed.pathname.match(/^\/v1\/admin\/users\/([^/]+)\/repo-grants$/);
  if (repoGrantsMatch) {
    const userId = decodeURIComponent(repoGrantsMatch[1]);
    if (parsed.method === "GET") {
      return handleGetUserRepoGrants(userId, response, deps, auth);
    }
    if (parsed.method === "PUT") {
      return handlePutUserRepoGrants(userId, parsed, response, deps, auth);
    }
  }

  const deleteMatch = parsed.pathname.match(/^\/v1\/admin\/users\/([^/]+)$/);
  if (deleteMatch && parsed.method === "DELETE") {
    return handleDeleteUser(decodeURIComponent(deleteMatch[1]), response, deps, auth);
  }

  return false;
}

async function handleGetUserRepoGrants(
  userId: string,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.userStore || !deps.orgStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }
  if (!(await requireTeamPlan(deps.orgStore, auth, response))) {
    return true;
  }
  const user = await deps.userStore.getUser(userId);
  if (!user || user.orgId !== auth.orgId) {
    writeJson(response, 404, { error: "user not found" });
    return true;
  }
  const pool = await getDbPool();
  if (!pool) {
    writeJson(response, 503, { error: "database not configured" });
    return true;
  }
  const grantStore = new UserRepoGrantStore(pool);
  const orgRepos = await deps.orgStore.listOrgRepos(auth.orgId);
  const indexedIds = indexedOrgRepoIds(orgRepos);
  // Self-heal: grants for disabled/removed indexes inflate admin "selected" counts.
  await grantStore.deleteOrphanGrants(auth.orgId, indexedIds);
  const repoIds = await grantStore.listUserRepoGrantIds(auth.orgId, userId);
  writeJson(response, 200, { userId, repoIds });
  return true;
}

async function handlePutUserRepoGrants(
  userId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.userStore || !deps.orgStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }
  if (!(await requireTeamPlan(deps.orgStore, auth, response))) {
    return true;
  }
  const user = await deps.userStore.getUser(userId);
  if (!user || user.orgId !== auth.orgId) {
    writeJson(response, 404, { error: "user not found" });
    return true;
  }
  const body = asRecord(parsed.body);
  const rawRepoIds = body.repoIds;
  if (!Array.isArray(rawRepoIds)) {
    writeJson(response, 400, { error: "repoIds array is required" });
    return true;
  }
  const repoIds = rawRepoIds.map((entry) => String(entry).trim()).filter(Boolean);
  try {
    const saved = await setUserRepoGrantsForOrg(deps, auth.orgId, userId, repoIds);
    await audit(deps, auth, "admin.user.repo_grants.set", { userId, count: saved.length });
    writeJson(response, 200, { userId, repoIds: saved.map((grant) => grant.repoId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update repo grants.";
    writeJson(response, 400, { error: "repo_grants_invalid", message });
  }
  return true;
}

async function setUserRepoGrantsForOrg(
  deps: AdminApiDeps,
  orgId: string,
  userId: string,
  repoIds: string[]
): Promise<Awaited<ReturnType<UserRepoGrantStore["setUserRepoGrants"]>>> {
  const pool = await getDbPool();
  if (!pool || !deps.orgStore) {
    throw new Error("database not configured");
  }
  const org = await deps.orgStore.getOrganization(orgId);
  if (org?.repoAccessMode !== "per_user") {
    throw new Error("Repository grants require per-user access mode.");
  }
  const orgRepos = await deps.orgStore.listOrgRepos(orgId);
  const indexedIds = new Set(indexedOrgRepoIds(orgRepos));
  for (const repoId of repoIds) {
    if (!indexedIds.has(repoId)) {
      throw new Error(`Repository is not Deep-Indexed for this organization: ${repoId}`);
    }
  }
  const grantStore = new UserRepoGrantStore(pool);
  return grantStore.setUserRepoGrants(orgId, userId, repoIds, {
    validateAgainstOrgRepos: async (repoId) =>
      orgRepos.some((repo) => repo.repoId === repoId)
  });
}

async function handlePatchUser(
  userId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.userStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }
  const existing = await deps.userStore.getUser(userId);
  if (!existing || existing.orgId !== auth.orgId) {
    writeJson(response, 404, { error: "user not found" });
    return true;
  }

  const body = asRecord(parsed.body);
  let updated = existing;

  if (body.role !== undefined) {
    const role = String(body.role).toLowerCase() as UserRole;
    if (!USER_ROLES.has(role)) {
      writeJson(response, 400, { error: "role must be admin or member" });
      return true;
    }
    const next = await deps.userStore.setUserRole(userId, role);
    if (!next) {
      writeJson(response, 404, { error: "user not found" });
      return true;
    }
    updated = next;
    await audit(deps, auth, "admin.user.role", { userId, role });
  }

  if (body.active === false) {
    if (deps.authTokenStore && !existing.lastLoginAt) {
      await deps.authTokenStore.revokeUnusedTokens(userId, "user_invite");
    }
    const deactivated = await deps.userStore.deactivateUser(userId);
    if (!deactivated && !existing.deactivatedAt) {
      writeJson(response, 404, { error: "user not found" });
      return true;
    }
    const refreshed = await deps.userStore.getUser(userId);
    if (refreshed) {
      updated = refreshed;
    }
    await audit(deps, auth, "admin.user.deactivate", { userId });
  }

  writeJson(response, 200, { user: toUserSummary(updated) });
  return true;
}

async function handleDeleteUser(
  userId: string,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.userStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }
  const existing = await deps.userStore.getUser(userId);
  if (!existing || existing.orgId !== auth.orgId) {
    writeJson(response, 404, { error: "user not found" });
    return true;
  }
  if (deps.authTokenStore && !existing.lastLoginAt) {
    await deps.authTokenStore.revokeUnusedTokens(userId, "user_invite");
  }
  await deps.userStore.deactivateUser(userId);
  await audit(deps, auth, "admin.user.deactivate", { userId });
  writeJson(response, 200, { ok: true, userId });
  return true;
}

function toUserSummary(user: {
  id: string;
  email: string;
  role: string;
  lastLoginAt?: Date;
  deactivatedAt?: Date;
  createdAt: Date;
  usageTier?: UsageTier | null;
}) {
  const status = namedSeatStatus(user);
  return {
    id: user.id,
    email: user.email,
    role: normalizeUserRole(user.role),
    active: status !== "deactivated",
    status,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    usageTier: user.usageTier ?? null
  };
}

async function handleConvertUserTier(
  userId: string,
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.userStore || !deps.orgStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }
  const body = asRecord(parsed.body);
  const toTier = parseUsageTier(typeof body.usageTier === "string" ? body.usageTier : "");
  if (!toTier) {
    writeJson(response, 400, { error: "invalid_tier", message: "usageTier must be pro, pro_plus, or max." });
    return true;
  }
  try {
    const result = await convertMemberUsageTier({
      orgId: auth.orgId,
      userId,
      toTier,
      orgStore: deps.orgStore,
      userStore: deps.userStore,
      stripe: new StripeService(loadBillingConfig()),
      billingConfig: loadBillingConfig()
    });
    const user = await deps.userStore.getUser(userId);
    await audit(deps, auth, "admin.user.usage_tier.convert", {
      userId,
      from: result.from,
      to: result.to
    });
    writeJson(response, 200, {
      user: user ? toUserSummary(user) : undefined,
      from: result.from,
      to: result.to,
      seatInventory: result.inventory
    });
  } catch (error) {
    const mapped = error instanceof SeatConvertError ? error : mapStripeConvertError(error);
    writeJson(response, mapped.statusCode, { error: mapped.code, message: mapped.message });
  }
  return true;
}

async function handleResolveUpgradeRequest(
  requestId: string,
  action: "confirmed" | "denied",
  response: ServerResponse,
  deps: AdminApiDeps,
  auth: AuthContext
): Promise<boolean> {
  if (!deps.userStore || !deps.orgStore) {
    writeJson(response, 503, { error: "user store not configured" });
    return true;
  }
  const pool = await getDbPool();
  if (!pool) {
    writeJson(response, 503, { error: "database not configured" });
    return true;
  }
  const requestStore = new SeatUpgradeRequestStore(pool);
  const pending = await requestStore.getById(requestId);
  if (!pending || pending.orgId !== auth.orgId) {
    writeJson(response, 404, { error: "request_not_found" });
    return true;
  }
  if (pending.status !== "pending") {
    writeJson(response, 409, { error: "request_not_pending", message: "This request was already resolved." });
    return true;
  }
  if (action === "denied") {
    await requestStore.resolve(requestId, "denied", auth.userId);
    await audit(deps, auth, "admin.seat_upgrade.denied", { requestId, userId: pending.userId });
    writeJson(response, 200, { ok: true, status: "denied" });
    return true;
  }
  try {
    const result = await convertMemberUsageTier({
      orgId: auth.orgId,
      userId: pending.userId,
      toTier: pending.toTier,
      orgStore: deps.orgStore,
      userStore: deps.userStore,
      stripe: new StripeService(loadBillingConfig()),
      billingConfig: loadBillingConfig()
    });
    await requestStore.resolve(requestId, "confirmed", auth.userId);
    await audit(deps, auth, "admin.seat_upgrade.confirmed", {
      requestId,
      userId: pending.userId,
      from: result.from,
      to: result.to
    });
    writeJson(response, 200, { ok: true, status: "confirmed", from: result.from, to: result.to });
  } catch (error) {
    if (error instanceof SeatConvertError) {
      writeJson(response, error.statusCode, { error: error.code, message: error.message });
      return true;
    }
    const message = error instanceof Error ? error.message : "Could not confirm upgrade.";
    writeJson(response, 502, { error: "convert_failed", message });
  }
  return true;
}

async function audit(
  deps: AdminApiDeps,
  auth: AuthContext,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const actor = auditActor(auth);
  await deps.auditLogger?.record({
    orgId: auth.orgId,
    userId: actor.userId,
    principal: actor.principal,
    action,
    metadata
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
