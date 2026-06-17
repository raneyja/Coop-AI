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
    description: "Repositories, PRs, and code context",
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
};
