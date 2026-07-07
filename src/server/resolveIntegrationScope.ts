import { requiresIntegrationScope } from "../license/planSearchScope";
import type { IntegrationProvider } from "./integrationConnectionStore";
import type { IntegrationScopePolicyStore } from "./integrationScopePolicyStore";
import {
  atlassianPolicyIsActive,
  googleDocsPolicyIsActive,
  notionPolicyIsActive,
  parseAtlassianIntegrationPolicy,
  parseGoogleDocsIntegrationPolicy,
  parseNotionIntegrationPolicy,
  parseSlackIntegrationPolicy,
  slackPolicyIsActive,
  type ResolvedIntegrationScope,
  type ScopeStatus
} from "../integrationScope/types";

export async function resolveIntegrationScope(options: {
  orgId: string;
  provider: IntegrationProvider;
  orgPlan: string;
  connected: boolean;
  scopePolicyStore?: IntegrationScopePolicyStore;
}): Promise<ResolvedIntegrationScope> {
  const { orgId, provider, orgPlan, connected, scopePolicyStore } = options;

  if (provider === "slack") {
    return resolveSlackScope(orgId, orgPlan, connected, scopePolicyStore);
  }

  if (provider === "atlassian") {
    return resolveAtlassianScope(orgId, orgPlan, connected, scopePolicyStore);
  }

  if (provider === "notion") {
    return resolveNotionScope(orgId, orgPlan, connected, scopePolicyStore);
  }

  if (provider === "google-docs") {
    return resolveGoogleDocsScope(orgId, orgPlan, connected, scopePolicyStore);
  }

  return unrestricted(provider, "none");
}

export function scopeStatusFromResolved(scope: ResolvedIntegrationScope): ScopeStatus {
  return scope.scopeStatus;
}

async function resolveSlackScope(
  orgId: string,
  orgPlan: string,
  connected: boolean,
  scopePolicyStore?: IntegrationScopePolicyStore
): Promise<ResolvedIntegrationScope> {
  const provider: IntegrationProvider = "slack";
  const scopeGated = requiresIntegrationScope(orgPlan);

  if (!connected) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason: "Slack is not connected for this organization."
    };
  }

  const record = scopePolicyStore ? await scopePolicyStore.get(orgId, provider) : undefined;
  const slackPolicy = parseSlackIntegrationPolicy(record?.policy);

  if (!slackPolicyIsActive(slackPolicy)) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason:
        "Slack is connected but no channels are allowlisted. An org admin must configure scope in the admin portal."
    };
  }

  const channelIds = slackPolicy!.channels.map((channel) => channel.id);
  const channelNames = slackPolicy!.channels.map((channel) => channel.name);

  return {
    provider,
    enforced: scopeGated,
    allowed: true,
    scopeStatus: "active",
    slack: { channelIds, channelNames }
  };
}

async function resolveAtlassianScope(
  orgId: string,
  orgPlan: string,
  connected: boolean,
  scopePolicyStore?: IntegrationScopePolicyStore
): Promise<ResolvedIntegrationScope> {
  const provider: IntegrationProvider = "atlassian";
  const scopeGated = requiresIntegrationScope(orgPlan);

  if (!connected) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason: "Atlassian is not connected for this organization."
    };
  }

  const record = scopePolicyStore ? await scopePolicyStore.get(orgId, provider) : undefined;
  const atlassianPolicy = parseAtlassianIntegrationPolicy(record?.policy);

  if (!atlassianPolicyIsActive(atlassianPolicy)) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason:
        "Atlassian is connected but no Jira projects or Confluence spaces are allowlisted. An org admin must configure scope in the admin portal."
    };
  }

  const jiraProjectIds = atlassianPolicy!.jiraProjects.map((project) => project.id);
  const jiraProjectKeys = atlassianPolicy!.jiraProjects.map((project) => project.key);
  const jiraProjectNames = atlassianPolicy!.jiraProjects.map((project) => project.name);
  const confluenceSpaceIds = atlassianPolicy!.confluenceSpaces.map((space) => space.id);
  const confluenceSpaceKeys = atlassianPolicy!.confluenceSpaces.map((space) => space.key);
  const confluenceSpaceNames = atlassianPolicy!.confluenceSpaces.map((space) => space.name);

  return {
    provider,
    enforced: scopeGated,
    allowed: true,
    scopeStatus: "active",
    atlassian: {
      jiraProjectIds,
      jiraProjectKeys,
      jiraProjectNames,
      confluenceSpaceIds,
      confluenceSpaceKeys,
      confluenceSpaceNames
    }
  };
}

async function resolveNotionScope(
  orgId: string,
  orgPlan: string,
  connected: boolean,
  scopePolicyStore?: IntegrationScopePolicyStore
): Promise<ResolvedIntegrationScope> {
  const provider: IntegrationProvider = "notion";
  const scopeGated = requiresIntegrationScope(orgPlan);

  if (!connected) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason: "Notion is not connected for this organization."
    };
  }

  const record = scopePolicyStore ? await scopePolicyStore.get(orgId, provider) : undefined;
  const notionPolicy = parseNotionIntegrationPolicy(record?.policy);

  if (!notionPolicyIsActive(notionPolicy)) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason:
        "Notion is connected but no pages or databases are allowlisted. An org admin must configure scope in the admin portal."
    };
  }

  const resourceIds = notionPolicy!.resources.map((resource) => resource.id);
  const resourceTitles = notionPolicy!.resources.map((resource) => resource.title);
  const resourceTypes = notionPolicy!.resources.map((resource) => resource.type);

  return {
    provider,
    enforced: scopeGated,
    allowed: true,
    scopeStatus: "active",
    notion: { resourceIds, resourceTitles, resourceTypes }
  };
}

async function resolveGoogleDocsScope(
  orgId: string,
  orgPlan: string,
  connected: boolean,
  scopePolicyStore?: IntegrationScopePolicyStore
): Promise<ResolvedIntegrationScope> {
  const provider: IntegrationProvider = "google-docs";
  const scopeGated = requiresIntegrationScope(orgPlan);

  if (!connected) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason: "Google Docs is not connected for this organization."
    };
  }

  const record = scopePolicyStore ? await scopePolicyStore.get(orgId, provider) : undefined;
  const googleDocsPolicy = parseGoogleDocsIntegrationPolicy(record?.policy);

  if (!googleDocsPolicyIsActive(googleDocsPolicy)) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason:
        "Google Docs is connected but no folders or shared drives are allowlisted. An org admin must configure scope in the admin portal."
    };
  }

  const folderIds = googleDocsPolicy!.folders.map((folder) => folder.id);
  const folderNames = googleDocsPolicy!.folders.map((folder) => folder.name);
  const folderKinds = googleDocsPolicy!.folders.map((folder) => folder.kind);
  const expandedFolderIds = googleDocsPolicy!.expandedFolderIds;

  return {
    provider,
    enforced: scopeGated,
    allowed: true,
    scopeStatus: "active",
    googleDocs: { folderIds, folderNames, folderKinds, expandedFolderIds }
  };
}

function unrestricted(provider: IntegrationProvider, scopeStatus: ScopeStatus): ResolvedIntegrationScope {
  return {
    provider,
    enforced: false,
    allowed: true,
    scopeStatus
  };
}
