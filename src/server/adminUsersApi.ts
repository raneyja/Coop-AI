import type { ServerResponse } from "node:http";
import { auditActor } from "./audit/auditLogger";
import { requireTeamPlan } from "./planGates";
import { loadBillingConfig } from "./billing/billingConfig";
import { adminPortalLoginUrl } from "./billing/adminPortalUrl";
import { EmailService } from "./email/emailService";
import type { AuthContext } from "./orgStore";
import type { UserRole } from "./users/userStore";
import { writeJson, type AdminApiDeps } from "./adminApiShared";
import { getDbPool } from "./db";
import { UserRepoGrantStore } from "./userRepoGrantStore";
import { indexedOrgRepoIds } from "./resolveAccessibleRepos";

type ParsedRequest = {
  method: string;
  pathname: string;
  body: unknown;
};

const USER_ROLES = new Set<UserRole>(["owner", "admin", "member"]);

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
    const activeUsers = users.filter((u) => !u.deactivatedAt).length;
    const billing = deps.orgStore ? await deps.orgStore.getOrganizationBilling(auth.orgId) : undefined;
    const seats = billing?.seatCount ?? 1;
    writeJson(response, 200, {
      users: users.map(toUserSummary),
      seats,
      seatsUsed: activeUsers
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
      writeJson(response, 400, { error: "role must be owner, admin, or member" });
      return true;
    }
    if (deps.orgStore) {
      const users = await deps.userStore.listOrgUsers(auth.orgId);
      const activeUsers = users.filter((u) => !u.deactivatedAt).length;
      const billing = await deps.orgStore.getOrganizationBilling(auth.orgId);
      const seats = billing?.seatCount ?? 1;
      if (activeUsers >= seats) {
        writeJson(response, 403, {
          error: "seat_limit_reached",
          seats,
          used: activeUsers
        });
        return true;
      }
    }
    const user = await deps.userStore.createUser(auth.orgId, email, role);
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
      await emailService.sendInvite({
        to: email,
        orgName: org?.name ?? "your organization",
        adminPortalUrl: adminPortalLoginUrl(billingConfig.adminPortalUrl),
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
      writeJson(response, 400, { error: "role must be owner, admin, or member" });
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
  await deps.userStore.deactivateUser(userId);
  await audit(deps, auth, "admin.user.deactivate", { userId });
  writeJson(response, 200, { ok: true, userId });
  return true;
}

function toUserSummary(user: {
  id: string;
  email: string;
  role: string;
  deactivatedAt?: Date;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: !user.deactivatedAt,
    createdAt: user.createdAt
  };
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
