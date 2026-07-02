import type { OrgPlan } from "./orgStore";

export type OrgRepoAccessMode = "all_indexed" | "per_user";

export const ORG_REPO_ACCESS_MODES: OrgRepoAccessMode[] = ["all_indexed", "per_user"];

export function parseOrgRepoAccessMode(value: unknown): OrgRepoAccessMode | undefined {
  if (value === "all_indexed" || value === "per_user") {
    return value;
  }
  return undefined;
}

/** Pro/Enterprise orgs use admin-selected indexing and org-level access policy. */
export function usesAdminRepoAccessPolicy(plan: OrgPlan): boolean {
  return plan === "pro" || plan === "enterprise";
}

export function defaultRepoAccessModeForPlan(plan: OrgPlan): OrgRepoAccessMode {
  return usesAdminRepoAccessPolicy(plan) ? "all_indexed" : "all_indexed";
}
