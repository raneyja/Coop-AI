export type StorySearchStep = {
  id: string;
  label: string;
  detail: string;
  kind: "graph" | "github" | "gitlab" | "slack" | "jira" | "bitbucket";
};

export type StoryRepoHit = {
  id: string;
  name: string;
  host: "github" | "gitlab" | "bitbucket";
  path: string;
  files: string[];
  risk: "high" | "medium" | "low";
};

export type StorySourceLink = {
  id: string;
  kind: "github" | "slack" | "jira" | "graph" | "commits" | "docs" | "codeowners";
  label: string;
  sublabel: string;
};

export type FileContextStory = {
  id: string;
  feature: string;
  activeTab: string;
  file: {
    name: string;
    path: string;
    symbol: string;
    language: string;
  };
  question: string;
  searchSteps: StorySearchStep[];
  repos: StoryRepoHit[];
  sources: StorySourceLink[];
  answer: {
    /** Cursor-style prose — parsed by the same rules as the extension ChatProse renderer */
    content: string;
  };
};

export const FILE_CONTEXT_STORIES: FileContextStory[] = [
  {
    id: "blast-radius",
    feature: "Blast Radius",
    activeTab: "token_validator.ts",
    file: {
      name: "token_validator.ts",
      path: "internal/auth/",
      symbol: "TokenValidator.validate()",
      language: "TypeScript"
    },
    question:
      "Hey Coop — I'm new to this repo. If I change TokenValidator.validate() in internal/auth/token_validator.ts, what's the blast radius? What breaks downstream across our services?",
    searchSteps: [
      {
        id: "graph",
        label: "Symbol graph",
        detail: "TokenValidator.validate() · 23 dependents",
        kind: "graph"
      },
      {
        id: "github-api",
        label: "GitHub · api-gateway",
        detail: "4 importers · runtime dependency",
        kind: "github"
      },
      {
        id: "github-worker",
        label: "GitHub · webhook-processor",
        detail: "2 importers · auth middleware chain",
        kind: "github"
      },
      {
        id: "gitlab-billing",
        label: "GitLab · billing-worker",
        detail: "batch retry path imports validate()",
        kind: "gitlab"
      },
      {
        id: "slack",
        label: "Slack · #billing-auth",
        detail: "Thread on empty-payload change · Sep 18",
        kind: "slack"
      },
      {
        id: "jira",
        label: "Jira · PROJ-1204",
        detail: "Auth hardening epic · linked files",
        kind: "jira"
      }
    ],
    repos: [
      {
        id: "api-gateway",
        name: "api-gateway",
        host: "github",
        path: "platform/api-gateway",
        files: ["middleware/auth.ts", "routes/session.ts", "hooks/validateJwt.ts"],
        risk: "high"
      },
      {
        id: "webhook-processor",
        name: "webhook-processor",
        host: "github",
        path: "workers/webhook-processor",
        files: ["internal/auth/validator.ts", "handlers/inbound.go"],
        risk: "high"
      },
      {
        id: "billing-worker",
        name: "billing-worker",
        host: "gitlab",
        path: "payments/billing-worker",
        files: ["pkg/auth/token.go", "jobs/retry_handler.go"],
        risk: "medium"
      }
    ],
    sources: [
      { id: "graph", kind: "graph", label: "23 dependents", sublabel: "symbol graph" },
      { id: "github", kind: "github", label: "PR #8821", sublabel: "shared auth path" },
      { id: "slack", kind: "slack", label: "#billing-auth", sublabel: "blast radius thread" },
      { id: "jira", kind: "jira", label: "PROJ-1204", sublabel: "Auth hardening epic" },
      { id: "owners", kind: "codeowners", label: "@jessica_dawson", sublabel: "90% blame · 60d" }
    ],
    answer: {
      content: `**Short answer**

Changing \`TokenValidator.validate()\` affects **23 dependents** across 3 services. Signature or empty-payload changes are breaking for \`api-gateway\` and \`webhook-processor\` — both import this module at runtime.

**Downstream impact**

- \`api-gateway\` — 4 importers (\`middleware/auth.ts\`, \`routes/session.ts\`, \`hooks/validateJwt.ts\`)
- \`webhook-processor\` — 2 importers in the auth middleware chain
- \`billing-worker\` (GitLab) — batch retry path imports \`validate()\`

**From your stack**

Slack thread in \`#billing-auth\` (Sep 18) covers empty-payload handling. Jira \`PROJ-1204\` tracks the auth hardening epic — link your change there.

\`@jessica_dawson\` owns 90% of recent blame on \`internal/auth/token_validator.ts\`.`
    }
  },
  {
    id: "trace-decision",
    feature: "Trace Decision",
    activeTab: "auth_middleware.go",
    file: {
      name: "auth_middleware.go",
      path: "internal/auth/",
      symbol: "AuthMiddleware()",
      language: "Go"
    },
    question:
      "Can you pull context on auth_middleware.go? I see zero-retention headers in here and I'm not sure why we added them — anything in Slack or Jira that explains it?",
    searchSteps: [
      {
        id: "graph",
        label: "Symbol graph",
        detail: "AuthMiddleware() · 14 refs · 3 packages",
        kind: "graph"
      },
      {
        id: "github",
        label: "GitHub · PR #842",
        detail: "Zero-retention headers · merged 12d ago",
        kind: "github"
      },
      {
        id: "slack",
        label: "Slack · #platform-auth",
        detail: "2 threads · incident #inc-auth-992",
        kind: "slack"
      },
      {
        id: "jira",
        label: "Jira · PROJ-1847",
        detail: "Add zero-retention headers to middleware",
        kind: "jira"
      },
      {
        id: "docs",
        label: "Confluence · Auth RFC v2",
        detail: "Design note in PR description",
        kind: "graph"
      }
    ],
    repos: [
      {
        id: "coop-backend",
        name: "coop-backend",
        host: "github",
        path: "coop-ai/coop-backend",
        files: ["internal/auth/auth_middleware.go", "internal/llm/router.go"],
        risk: "medium"
      },
      {
        id: "api-gateway",
        name: "api-gateway",
        host: "github",
        path: "platform/api-gateway",
        files: ["middleware/auth.go"],
        risk: "low"
      }
    ],
    sources: [
      { id: "github", kind: "github", label: "PR #842", sublabel: "merged 12d ago" },
      { id: "slack", kind: "slack", label: "#platform-auth", sublabel: "2 threads" },
      { id: "jira", kind: "jira", label: "PROJ-1847", sublabel: "In Progress" },
      { id: "graph", kind: "graph", label: "14 downstream refs", sublabel: "3 packages" },
      { id: "docs", kind: "docs", label: "Auth RFC v2", sublabel: "Confluence" }
    ],
    answer: {
      content: `**Short answer**

PR #842 added zero-retention headers after incident \`#inc-auth-992\`. \`AuthMiddleware()\` sets provider retention flags before requests reach \`internal/llm/router.go\`.

**Decision trail**

- Jira \`PROJ-1847\` — "Add zero-retention headers to middleware"
- Slack \`#platform-auth\` — Marcus proposed headers Aug 12; Elena confirmed with security Sep 3
- Confluence Auth RFC v2 linked from the PR description

**Where it runs**

\`\`\`42:48:internal/auth/auth_middleware.go
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Zero-Retention", "true")
		next.ServeHTTP(w, r)
	})
}
\`\`\`

14 downstream refs include \`api-gateway\` middleware — not an isolated change. Recent commits on \`router.go\` cover the full picture.`
    }
  }
];

export function getFileContextStory(id: string): FileContextStory {
  const story = FILE_CONTEXT_STORIES.find((s) => s.id === id);
  if (!story) throw new Error(`Unknown story: ${id}`);
  return story;
}
