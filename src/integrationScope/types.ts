import type { IntegrationProvider } from "../server/integrationConnectionStore";

export type SlackChannelRef = {
  id: string;
  name: string;
};

export type SlackIntegrationPolicy = {
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

export type AtlassianIntegrationPolicy = {
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

export type NotionIntegrationPolicy = {
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

export type GoogleDocsIntegrationPolicy = {
  version: 1;
  mode: "allowlist";
  folders: GoogleDocsFolderRef[];
  expandedFolderIds: string[];
};

export type IntegrationScopePolicy =
  | SlackIntegrationPolicy
  | AtlassianIntegrationPolicy
  | NotionIntegrationPolicy
  | GoogleDocsIntegrationPolicy;

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
  reason?: string;
};

export const SCOPE_GOVERNED_PROVIDERS: IntegrationProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs"
];

export function parseSlackIntegrationPolicy(raw: unknown): SlackIntegrationPolicy | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
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
    mode: "allowlist",
    folders,
    expandedFolderIds
  };
}

export function googleDocsPolicyIsActive(policy: GoogleDocsIntegrationPolicy | undefined): boolean {
  return Boolean(policy && policy.folders.length > 0);
}
