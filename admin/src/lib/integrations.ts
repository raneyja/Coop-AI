export type IntegrationProvider =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "atlassian"
  | "notion"
  | "google-docs"
  | "teams";

export type CodeHostProvider = Extract<IntegrationProvider, "github" | "gitlab" | "bitbucket">;

export const CODE_HOST_PROVIDERS: CodeHostProvider[] = ["github", "gitlab", "bitbucket"];

export type ScopableProvider = Extract<
  IntegrationProvider,
  "slack" | "atlassian" | "notion" | "google-docs"
>;

export const SCOPABLE_PROVIDERS: ScopableProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs"
];

export type IntegrationDefinition = {
  id: IntegrationProvider;
  name: string;
  description: string;
  category: "code" | "collaboration" | "docs";
  comingSoon?: boolean;
};

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "github",
    name: "GitHub",
    description: "GitHub App for org-wide indexing (recommended). OAuth fallback for limited personal access.",
    category: "code"
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Repositories, merge requests, and code context",
    category: "code"
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    description: "Repositories and pull requests",
    category: "code"
  },
  {
    id: "slack",
    name: "Slack",
    description: "Team messages and presence",
    category: "collaboration"
  },
  {
    id: "atlassian",
    name: "Jira & Confluence",
    description: "Issues, docs, and project tracking",
    category: "collaboration"
  },
  {
    id: "notion",
    name: "Notion",
    description: "Workspace pages and databases",
    category: "docs"
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Documents and shared drives",
    category: "docs"
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Channels and enterprise chat",
    category: "collaboration",
    comingSoon: true
  }
];

export type IntegrationStatus = {
  provider: IntegrationProvider;
  installed: boolean;
  needsReconnect?: boolean;
  detail?: string;
  scopeStatus?: "none" | "required" | "active";
  scopeSummary?: string;
  scopeNeedsReconnect?: boolean;
  connectionKind?: "github_app" | "oauth";
};

export type SlackScopeChannel = {
  id: string;
  name: string;
};

export type SlackScopePolicy = {
  version: 1;
  mode: "allowlist";
  channels: SlackScopeChannel[];
};

export type AtlassianScopePolicy = {
  version: 1;
  mode: "allowlist";
  jiraProjects: Array<{ id: string; key: string; name: string }>;
  confluenceSpaces: Array<{ id: string; key: string; name: string }>;
};

export type NotionScopePolicy = {
  version: 1;
  mode: "allowlist";
  resources: Array<{ id: string; title: string; type: "page" | "database" }>;
};

export type GoogleDocsScopePolicy = {
  version: 1;
  mode: "allowlist";
  folders: Array<{ id: string; name: string; kind: "folder" | "shared_drive" }>;
  expandedFolderIds?: string[];
};

export type IntegrationScopeResponse = {
  provider: IntegrationProvider;
  installed: boolean;
  scopeStatus: "none" | "required" | "active";
  enforced: boolean;
  allowed: boolean;
  policy: SlackScopePolicy | AtlassianScopePolicy | NotionScopePolicy | GoogleDocsScopePolicy;
  summary?: string;
  updatedAt?: string;
};

export type IntegrationResource = {
  id: string;
  name: string;
  key?: string;
  type?: string;
  kind?: string;
  isPrivate?: boolean;
  topic?: string;
};
