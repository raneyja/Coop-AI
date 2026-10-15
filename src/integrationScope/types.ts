import type { IntegrationProvider } from "../server/integrationConnectionStore";

/** Organization-approved shared source access, independent of vendor member ACLs. */
export type IntegrationAccessPolicy = {
  mode: "organization-approved" | "member-grants";
  directory?: boolean;
  members?: Record<string, string[]>;
};
type IntegrationSourceAccess = { access?: IntegrationAccessPolicy };

export function parseIntegrationAccess(raw: unknown): IntegrationAccessPolicy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.mode !== "organization-approved" && value.mode !== "member-grants") return undefined;
  if (Object.keys(value).some(key => !["mode", "directory", "members"].includes(key))) return undefined;
  if (value.directory !== undefined && typeof value.directory !== "boolean") return undefined;
  if (value.mode === "organization-approved") {
    if (value.members !== undefined) return undefined;
    return { mode: value.mode, ...(value.directory !== undefined ? { directory: value.directory as boolean } : {}) };
  }
  if (!value.members || typeof value.members !== "object" || Array.isArray(value.members)) return undefined;
  const entries = Object.entries(value.members);
  if (entries.length > 1000 || entries.some(([principal, grants]) => !/^[a-zA-Z0-9_:@-]{1,200}$/.test(principal) ||
      !Array.isArray(grants) || grants.length > 1000 || grants.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_.:@-]{1,200}$/.test(id)))) return undefined;
  return { mode: value.mode, members: Object.fromEntries(entries) as Record<string, string[]>,
    ...(value.directory !== undefined ? { directory: value.directory as boolean } : {}) };
}

export type SlackChannelRef = {
  id: string;
  name: string;
};

export type SlackIntegrationPolicy = IntegrationSourceAccess & {
  version: 1;
  mode: "allowlist";
  channels: SlackChannelRef[];
};

export type AtlassianProjectRef = {
  id: string;
  key: string;
  name: string;
};

export type AtlassianSpaceRef = {
  id: string;
  key: string;
  name: string;
};

export type AtlassianIntegrationPolicy = IntegrationSourceAccess & {
  version: 1;
  mode: "allowlist";
  jiraProjects: AtlassianProjectRef[];
  confluenceSpaces: AtlassianSpaceRef[];
};

export type NotionResourceType = "page" | "database";

export type NotionResourceRef = {
  id: string;
  title: string;
  type: NotionResourceType;
};

export type NotionIntegrationPolicy = IntegrationSourceAccess & {
  version: 1;
  mode: "allowlist";
  resources: NotionResourceRef[];
};

export type GoogleDocsFolderKind = "folder" | "shared_drive";

export type GoogleDocsFolderRef = {
  id: string;
  name: string;
  kind: GoogleDocsFolderKind;
};

export type GoogleDocsIntegrationPolicy = IntegrationSourceAccess & {
  version: 1;
  mode: "allowlist";
  folders: GoogleDocsFolderRef[];
  expandedFolderIds: string[];
};

export type TeamsChannelRef = {
  id: string;
  name: string;
  teamId?: string;
  teamName?: string;
};

export type TeamsIntegrationPolicy = IntegrationSourceAccess & {
  version: 1;
  mode: "allowlist";
  channels: TeamsChannelRef[];
};

export type IntegrationScopePolicy =
  | SlackIntegrationPolicy
  | AtlassianIntegrationPolicy
  | NotionIntegrationPolicy
  | GoogleDocsIntegrationPolicy
  | TeamsIntegrationPolicy;

export type ScopeStatus = "none" | "required" | "active";

export type ResolvedIntegrationScope = {
  provider: IntegrationProvider;
  enforced: boolean;
  allowed: boolean;
  scopeStatus: ScopeStatus;
  slack?: {
    channelIds: string[];
    channelNames: string[];
  };
  atlassian?: {
    jiraProjectIds: string[];
    jiraProjectKeys: string[];
    jiraProjectNames: string[];
    confluenceSpaceIds: string[];
    confluenceSpaceKeys: string[];
    confluenceSpaceNames: string[];
  };
  notion?: {
    resourceIds: string[];
    resourceTitles: string[];
    resourceTypes: NotionResourceType[];
  };
  googleDocs?: {
    folderIds: string[];
    folderNames: string[];
    folderKinds: GoogleDocsFolderKind[];
    expandedFolderIds: string[];
  };
  teams?: {
    channelIds: string[];
    channelNames: string[];
    teamIds: string[];
    channelTeamIds?: Record<string, string>;
  };
  reason?: string;
};

export const SCOPE_GOVERNED_PROVIDERS: IntegrationProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
];

/** Providers with admin allowlist scope enforced in chat context fetchers. */
export type ScopedIntegrationProvider = (typeof SCOPE_GOVERNED_PROVIDERS)[number];

export function parseSlackIntegrationPolicy(raw: unknown): SlackIntegrationPolicy | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const access = parseIntegrationAccess(record.access);
  if (record.access !== undefined && !access) return undefined;
  if (record.mode !== "allowlist") {
    return undefined;
  }
  const channelsRaw = record.channels;
  if (!Array.isArray(channelsRaw)) {
    return undefined;
  }
  const channels: SlackChannelRef[] = [];
  for (const entry of channelsRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const channel = entry as Record<string, unknown>;
    const id = typeof channel.id === "string" ? channel.id.trim() : "";
    const name = typeof channel.name === "string" ? channel.name.trim() : "";
    if (id && name) {
      channels.push({ id, name });
    }
  }
  return {
    version: 1,
    ...(access ? { access } : {}),
    mode: "allowlist",
    channels
  };
}

export function slackPolicyIsActive(policy: SlackIntegrationPolicy | undefined): boolean {
  return Boolean(policy && policy.channels.length > 0);
}

export function parseAtlassianIntegrationPolicy(
  raw: unknown
): AtlassianIntegrationPolicy | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const access = parseIntegrationAccess(record.access);
  if (record.access !== undefined && !access) return undefined;
  if (record.mode !== "allowlist") {
    return undefined;
  }

  const jiraProjectsRaw = record.jiraProjects;
  const confluenceSpacesRaw = record.confluenceSpaces;
  if (!Array.isArray(jiraProjectsRaw) || !Array.isArray(confluenceSpacesRaw)) {
    return undefined;
  }

  const jiraProjects: AtlassianProjectRef[] = [];
  for (const entry of jiraProjectsRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const project = entry as Record<string, unknown>;
    const id = typeof project.id === "string" ? project.id.trim() : "";
    const key = typeof project.key === "string" ? project.key.trim() : "";
    const name = typeof project.name === "string" ? project.name.trim() : "";
    if (id && key && name) {
      jiraProjects.push({ id, key, name });
    }
  }

  const confluenceSpaces: AtlassianSpaceRef[] = [];
  for (const entry of confluenceSpacesRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const space = entry as Record<string, unknown>;
    const id = typeof space.id === "string" ? space.id.trim() : "";
    const key = typeof space.key === "string" ? space.key.trim() : "";
    const name = typeof space.name === "string" ? space.name.trim() : "";
    if (id && key && name) {
      confluenceSpaces.push({ id, key, name });
    }
  }

  return {
    version: 1,
    ...(access ? { access } : {}),
    mode: "allowlist",
    jiraProjects,
    confluenceSpaces
  };
}

export function atlassianPolicyIsActive(policy: AtlassianIntegrationPolicy | undefined): boolean {
  return Boolean(
    policy && (policy.jiraProjects.length > 0 || policy.confluenceSpaces.length > 0)
  );
}

export function parseNotionIntegrationPolicy(raw: unknown): NotionIntegrationPolicy | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const access = parseIntegrationAccess(record.access);
  if (record.access !== undefined && !access) return undefined;
  if (record.mode !== "allowlist") {
    return undefined;
  }
  const resourcesRaw = record.resources;
  if (!Array.isArray(resourcesRaw)) {
    return undefined;
  }
  const resources: NotionResourceRef[] = [];
  for (const entry of resourcesRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const resource = entry as Record<string, unknown>;
    const id = typeof resource.id === "string" ? resource.id.trim() : "";
    const title = typeof resource.title === "string" ? resource.title.trim() : "";
    const type = resource.type === "page" || resource.type === "database" ? resource.type : undefined;
    if (id && title && type) {
      resources.push({ id, title, type });
    }
  }
  return {
    version: 1,
    ...(access ? { access } : {}),
    mode: "allowlist",
    resources
  };
}

export function notionPolicyIsActive(policy: NotionIntegrationPolicy | undefined): boolean {
  return Boolean(policy && policy.resources.length > 0);
}

export function parseGoogleDocsIntegrationPolicy(
  raw: unknown
): GoogleDocsIntegrationPolicy | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const access = parseIntegrationAccess(record.access);
  if (record.access !== undefined && !access) return undefined;
  if (record.mode !== "allowlist") {
    return undefined;
  }
  const foldersRaw = record.folders;
  if (!Array.isArray(foldersRaw)) {
    return undefined;
  }
  const folders: GoogleDocsFolderRef[] = [];
  for (const entry of foldersRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const folder = entry as Record<string, unknown>;
    const id = typeof folder.id === "string" ? folder.id.trim() : "";
    const name = typeof folder.name === "string" ? folder.name.trim() : "";
    const kind =
      folder.kind === "folder" || folder.kind === "shared_drive" ? folder.kind : undefined;
    if (id && name && kind) {
      folders.push({ id, name, kind });
    }
  }
  const expandedFolderIds: string[] = [];
  const expandedRaw = record.expandedFolderIds;
  if (Array.isArray(expandedRaw)) {
    for (const entry of expandedRaw) {
      if (typeof entry === "string" && entry.trim()) {
        expandedFolderIds.push(entry.trim());
      }
    }
  }
  return {
    version: 1,
    ...(access ? { access } : {}),
    mode: "allowlist",
    folders,
    expandedFolderIds
  };
}

export function googleDocsPolicyIsActive(policy: GoogleDocsIntegrationPolicy | undefined): boolean {
  return Boolean(policy && policy.folders.length > 0);
}

export function parseTeamsIntegrationPolicy(raw: unknown): TeamsIntegrationPolicy | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const access = parseIntegrationAccess(record.access);
  if (record.access !== undefined && !access) return undefined;
  if (record.mode !== "allowlist") {
    return undefined;
  }
  const channelsRaw = record.channels;
  if (!Array.isArray(channelsRaw)) {
    return undefined;
  }
  const channels: TeamsChannelRef[] = [];
  for (const entry of channelsRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const channel = entry as Record<string, unknown>;
    const id = typeof channel.id === "string" ? channel.id.trim() : "";
    const name = typeof channel.name === "string" ? channel.name.trim() : "";
    const teamId = typeof channel.teamId === "string" ? channel.teamId.trim() : "";
    const teamName = typeof channel.teamName === "string" ? channel.teamName.trim() : "";
    if (id && name) {
      channels.push({
        id,
        name,
        ...(teamId ? { teamId } : {}),
        ...(teamName ? { teamName } : {})
      });
    }
  }
  return {
    version: 1,
    ...(access ? { access } : {}),
    mode: "allowlist",
    channels
  };
}

export function teamsPolicyIsActive(policy: TeamsIntegrationPolicy | undefined): boolean {
  return Boolean(policy && policy.channels.length > 0);
}
