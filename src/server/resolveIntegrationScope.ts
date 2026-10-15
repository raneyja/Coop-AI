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
  parseTeamsIntegrationPolicy,
  slackPolicyIsActive,
  teamsPolicyIsActive,
  type ResolvedIntegrationScope,
  type ScopeStatus
} from "../integrationScope/types";

export async function resolveIntegrationScope(options: {
  orgId: string;
  provider: IntegrationProvider;
  orgPlan: string;
  connected: boolean;
  scopePolicyStore?: Pick<IntegrationScopePolicyStore, "get">;
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

  if (provider === "teams") {
    return resolveTeamsScope(orgId, orgPlan, connected, scopePolicyStore);
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
  scopePolicyStore?: Pick<IntegrationScopePolicyStore, "get">
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
  scopePolicyStore?: Pick<IntegrationScopePolicyStore, "get">
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
  scopePolicyStore?: Pick<IntegrationScopePolicyStore, "get">
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
  scopePolicyStore?: Pick<IntegrationScopePolicyStore, "get">
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

async function resolveTeamsScope(
  orgId: string,
  orgPlan: string,
  connected: boolean,
  scopePolicyStore?: Pick<IntegrationScopePolicyStore, "get">
): Promise<ResolvedIntegrationScope> {
  const provider: IntegrationProvider = "teams";
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
      reason: "Microsoft Teams is not connected for this organization."
    };
  }

  const record = scopePolicyStore ? await scopePolicyStore.get(orgId, provider) : undefined;
  const teamsPolicy = parseTeamsIntegrationPolicy(record?.policy);

  if (!teamsPolicyIsActive(teamsPolicy)) {
    if (!scopeGated) {
      return unrestricted(provider, "none");
    }
    return {
      provider,
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason:
        "Microsoft Teams is connected but no channels are allowlisted. An org admin must configure scope in the admin portal."
    };
  }

  return {
    provider,
    enforced: scopeGated,
    allowed: true,
    scopeStatus: "active",
    teams: {
      channelIds: teamsPolicy!.channels.map((channel) => channel.id),
      channelNames: teamsPolicy!.channels.map((channel) => channel.name),
      channelTeamIds: Object.fromEntries(teamsPolicy!.channels.filter(channel => channel.teamId).map(channel => [channel.id, channel.teamId!])),
      teamIds: [
        ...new Set(
          teamsPolicy!.channels
            .map((channel) => channel.teamId)
            .filter((id): id is string => Boolean(id))
        )
      ]
    }
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

/** Shared install access is organization-approved; it never inherits an individual vendor ACL. */
export async function resolveActorIntegrationScope(options: {
  orgId: string; provider: IntegrationProvider; connected: boolean;
  scopePolicyStore?: Pick<IntegrationScopePolicyStore, "get">; principal: string;
}): Promise<ResolvedIntegrationScope> {
  // Resolve the source allowlist and member grants from one policy snapshot.
  const record = await options.scopePolicyStore?.get(options.orgId, options.provider);
  const scope = await resolveIntegrationScope({ ...options, orgPlan: "enterprise",
    scopePolicyStore: { get: async () => record } });
  if (!scope.allowed) return scope;
  const denied = (): ResolvedIntegrationScope => ({ provider: options.provider,
    enforced: true, allowed: false, scopeStatus: "required", reason: "Integration sources are not authorized for this actor." });
  const access = (record?.policy as { access?: unknown } | undefined)?.access;
  if (access === undefined) return scope; // Existing allowlists approve those sources for org members.
  if (!access || typeof access !== "object") return denied();
  const policy = access as { mode?: unknown; members?: unknown; directory?: unknown };
  if (policy.mode === "organization-approved") return scope;
  if (policy.mode !== "member-grants" || !policy.members || typeof policy.members !== "object") return denied();
  const grants = (policy.members as Record<string, unknown>)[options.principal];
  if (!Array.isArray(grants) || grants.some(value => typeof value !== "string")) return denied();
  const allowed = new Set(grants);
  if (scope.slack) {
    const indices = scope.slack.channelIds.map((value, i) => allowed.has(value) ? i : -1).filter(i => i >= 0);
    scope.slack = { channelIds: indices.map(i => scope.slack!.channelIds[i]!), channelNames: indices.map(i => scope.slack!.channelNames[i]!) };
  }
  if (scope.atlassian) {
    const a = scope.atlassian;
    const projects = a.jiraProjectIds.map((value, i) => allowed.has(value) ? i : -1).filter(i => i >= 0);
    const spaces = a.confluenceSpaceIds.map((value, i) => allowed.has(value) ? i : -1).filter(i => i >= 0);
    scope.atlassian = { jiraProjectIds: projects.map(i => a.jiraProjectIds[i]!), jiraProjectKeys: projects.map(i => a.jiraProjectKeys[i]!),
      jiraProjectNames: projects.map(i => a.jiraProjectNames[i]!), confluenceSpaceIds: spaces.map(i => a.confluenceSpaceIds[i]!),
      confluenceSpaceKeys: spaces.map(i => a.confluenceSpaceKeys[i]!), confluenceSpaceNames: spaces.map(i => a.confluenceSpaceNames[i]!) };
  }
  if (scope.notion) {
    const n = scope.notion; const indices = n.resourceIds.map((value, i) => allowed.has(value) ? i : -1).filter(i => i >= 0);
    scope.notion = { resourceIds: indices.map(i => n.resourceIds[i]!), resourceTitles: indices.map(i => n.resourceTitles[i]!), resourceTypes: indices.map(i => n.resourceTypes[i]!) };
  }
  if (scope.googleDocs) {
    const g = scope.googleDocs;
    // Folder grants must explicitly name expanded children; membership cannot widen to an entire drive.
    const indices = g.folderIds.map((value, i) => allowed.has(value) ? i : -1).filter(i => i >= 0);
    scope.googleDocs = {
      folderIds: indices.map(i => g.folderIds[i]!),
      folderNames: indices.map(i => g.folderNames[i]!),
      folderKinds: indices.map(i => g.folderKinds[i]!),
      expandedFolderIds: g.expandedFolderIds.filter(value => allowed.has(value))
    };
  }
  if (scope.teams) {
    const t = scope.teams;
    const indices = t.channelIds.map((value, i) => allowed.has(value) ? i : -1).filter(i => i >= 0);
    const channelIds = indices.map(i => t.channelIds[i]!);
    const channelTeamIds = Object.fromEntries(channelIds.flatMap(channel => t.channelTeamIds?.[channel] ? [[channel, t.channelTeamIds[channel]!]] : []));
    scope.teams = {
      channelIds,
      channelNames: indices.map(i => t.channelNames[i]!),
      channelTeamIds,
      teamIds: [...new Set(Object.values(channelTeamIds))]
    };
  }
  return scope;
}
