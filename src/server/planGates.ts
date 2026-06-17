import type { ServerResponse } from "node:http";
import type { CodeHostProvider } from "../api/codeHosts/types";
import { PRICING_PAGE_URL } from "../config/siteConfig";
import type { OrgPlan, OrgStore } from "./orgStore";
import { isPlanAllowed, requireOrgPlan, resolveOrgPlanFromDb, type AuthContext } from "./authMiddleware";

export const CODE_HOST_GITHUB_PLANS: OrgPlan[] = ["pro", "enterprise"];
export const CODE_HOST_GITLAB_BITBUCKET_PLANS: OrgPlan[] = ["enterprise"];

export function codeHostPlansForProvider(provider: CodeHostProvider): OrgPlan[] {
  return provider === "github" ? CODE_HOST_GITHUB_PLANS : CODE_HOST_GITLAB_BITBUCKET_PLANS;
}

export function writeCodeHostPlanForbidden(
  response: ServerResponse,
  provider: CodeHostProvider
): void {
  const required = codeHostPlansForProvider(provider);
  const upgrade =
    provider === "github"
      ? "Upgrade to Pro to connect GitHub and use remote code graph features."
      : "GitLab and Bitbucket require an Enterprise plan.";
  response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      error: "code_host_plan_required",
      message: `Code host connections are not available on the free plan. ${upgrade}`,
      requiredPlans: required,
      provider,
      upgradeUrl: PRICING_PAGE_URL
    })
  );
}

export function writeRemoteCodePlanForbidden(response: ServerResponse): void {
  response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      error: "remote_code_plan_required",
      message:
        "Remote code graph and cloud repo browsing require Pro. Free plan is limited to local workspace files.",
      requiredPlans: CODE_HOST_GITHUB_PLANS,
      upgradeUrl: PRICING_PAGE_URL
    })
  );
}

export function writeTeamNotAvailableOnFree(response: ServerResponse): void {
  response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      error: "team_not_available",
      message:
        "The free plan is individual only — one seat per account. Upgrade to Pro to invite teammates.",
      upgradeUrl: PRICING_PAGE_URL
    })
  );
}

export async function requireCodeHostPlan(
  orgStore: OrgStore | undefined,
  auth: AuthContext,
  response: ServerResponse,
  provider: CodeHostProvider
): Promise<boolean> {
  const plan = await resolveOrgPlanFromDb(orgStore, auth);
  if (!plan || !isPlanAllowed(plan, codeHostPlansForProvider(provider))) {
    writeCodeHostPlanForbidden(response, provider);
    return false;
  }
  return true;
}

export function writeCodeHostPlanForbiddenHtml(
  response: ServerResponse,
  provider: CodeHostProvider
): void {
  const required = codeHostPlansForProvider(provider);
  const message =
    provider === "github"
      ? "GitHub connections require a Pro plan. The free plan is limited to local workspace files."
      : "This code host requires an Enterprise plan.";
  response.writeHead(403, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!DOCTYPE html><html><body><p>${message}</p><p>Required plan: ${required.join(" or ")}.</p></body></html>`);
}

export async function requireCodeHostPlanForOrg(
  orgStore: OrgStore,
  orgId: string,
  response: ServerResponse,
  provider: CodeHostProvider,
  html = false
): Promise<boolean> {
  const org = await orgStore.getOrganization(orgId);
  if (!org || !isPlanAllowed(org.plan, codeHostPlansForProvider(provider))) {
    if (html) {
      writeCodeHostPlanForbiddenHtml(response, provider);
    } else {
      writeCodeHostPlanForbidden(response, provider);
    }
    return false;
  }
  return true;
}

export async function requireRemoteCodePlan(
  orgStore: OrgStore | undefined,
  auth: AuthContext,
  response: ServerResponse
): Promise<boolean> {
  return requireOrgPlan(orgStore, auth, response, ...CODE_HOST_GITHUB_PLANS);
}

export async function requireTeamPlan(
  orgStore: OrgStore | undefined,
  auth: AuthContext,
  response: ServerResponse
): Promise<boolean> {
  const plan = await resolveOrgPlanFromDb(orgStore, auth);
  if (plan === "free") {
    writeTeamNotAvailableOnFree(response);
    return false;
  }
  return true;
}

export function clampSeatCountForPlan(plan: OrgPlan, seatCount: number): number {
  if (plan === "free") {
    return 1;
  }
  return Math.max(1, Math.floor(seatCount));
}
