export type OrgIntegrationProvider =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "atlassian"
  | "notion"
  | "google-docs"
  | "teams";

export type OrgIntegrationScopeStatus = "none" | "required" | "active";

export type OrgIntegrationStatusEntry = {
  provider: OrgIntegrationProvider;
  installed: boolean;
  needsReconnect?: boolean;
  scopeNeedsReconnect?: boolean;
  scopeStatus?: OrgIntegrationScopeStatus;
  scopeSummary?: string;
};

export type MemberToolStatus = "ready" | "pending_admin_setup" | "not_enabled" | "unavailable";
