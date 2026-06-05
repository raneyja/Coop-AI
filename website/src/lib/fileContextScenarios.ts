export type OrbitNodeKind =
  | "github"
  | "slack"
  | "jira"
  | "commits"
  | "docs"
  | "graph"
  | "gap"
  | "notion"
  | "codeowners"
  | "services";

export type FileContextScenario = {
  id: string;
  feature: "Trace Decision" | "Blast Radius" | "Knowledge Gaps" | "Understand Repo";
  file: {
    name: string;
    path: string;
    language: string;
    symbol?: string;
  };
  sourceCount: number;
  orbitNodes: Array<{
    id: string;
    kind: OrbitNodeKind;
    label: string;
    sublabel: string;
    tooltip: string;
    angle: number;
    radius: number;
    weight: "primary" | "secondary";
    isGap?: boolean;
  }>;
  contextPacket: Array<{
    id: string;
    source: string;
    detail: string;
    toggleable?: boolean;
  }>;
  exampleQuestion: string;
  highlights: [string, string];
};

export const FILE_CONTEXT_SCENARIOS: FileContextScenario[] = [
  {
    id: "auth-middleware",
    feature: "Trace Decision",
    file: {
      name: "auth_middleware.go",
      path: "internal/auth/",
      language: "Go",
      symbol: "AuthMiddleware()"
    },
    sourceCount: 6,
    orbitNodes: [
      {
        id: "pr-842",
        kind: "github",
        label: "PR #842",
        sublabel: "merged 12d ago",
        tooltip: "Zero-retention headers · links internal/llm/router.go",
        angle: -128,
        radius: 248,
        weight: "primary"
      },
      {
        id: "jira-1847",
        kind: "jira",
        label: "PROJ-1847",
        sublabel: "In Progress",
        tooltip: "Add zero-retention headers to auth middleware",
        angle: -52,
        radius: 255,
        weight: "primary"
      },
      {
        id: "slack-platform",
        kind: "slack",
        label: "#platform-auth",
        sublabel: "2 threads",
        tooltip: "Thread from incident #inc-auth-992 · Aug 12 & Sep 3",
        angle: -168,
        radius: 218,
        weight: "primary"
      },
      {
        id: "confluence-rfc",
        kind: "docs",
        label: "Auth RFC v2",
        sublabel: "Confluence",
        tooltip: "Design note referenced in PR #842 description",
        angle: 158,
        radius: 235,
        weight: "secondary"
      },
      {
        id: "commits-90d",
        kind: "commits",
        label: "3 commits · 90d",
        sublabel: "@marcus · @elena",
        tooltip: "Security review path · OAuth refresh adjacent changes",
        angle: 118,
        radius: 268,
        weight: "secondary"
      },
      {
        id: "symbol-refs",
        kind: "graph",
        label: "14 downstream refs",
        sublabel: "3 packages",
        tooltip: "api-gateway · session/store.go · internal/llm/router.go",
        angle: 28,
        radius: 242,
        weight: "primary"
      }
    ],
    contextPacket: [
      { id: "graph", source: "Code graph", detail: "AuthMiddleware() · 14 refs · 3 packages" },
      {
        id: "github",
        source: "GitHub",
        detail: "PR #842 · 12 commits · CODEOWNERS @platform-auth",
        toggleable: true
      },
      {
        id: "slack",
        source: "Slack",
        detail: "#platform-auth · threads Aug 12, Sep 3",
        toggleable: true
      },
      {
        id: "jira",
        source: "Jira",
        detail: "PROJ-1847 · zero-retention headers",
        toggleable: true
      },
      { id: "confluence", source: "Confluence", detail: "Auth middleware RFC v2" },
      { id: "model", source: "Model", detail: "Routed via BYOK · zero-retention flags" }
    ],
    exampleQuestion:
      "Pull the Slack thread and Jira ticket tied to `auth_middleware.go` — why did we add zero-retention headers here? Cross-reference commits on `internal/llm/router.go` from the last 90 days.",
    highlights: ["#platform-auth thread", "PROJ-1847 + commits"]
  },
  {
    id: "token-validator",
    feature: "Blast Radius",
    file: {
      name: "token_validator.ts",
      path: "internal/auth/",
      language: "TypeScript",
      symbol: "TokenValidator.validate()"
    },
    sourceCount: 6,
    orbitNodes: [
      {
        id: "dependents",
        kind: "graph",
        label: "23 dependents",
        sublabel: "symbol graph",
        tooltip: "TokenValidator.validate() · cross-service impact",
        angle: -90,
        radius: 262,
        weight: "primary"
      },
      {
        id: "pr-8821",
        kind: "github",
        label: "PR #8821",
        sublabel: "shared auth path",
        tooltip: "Empty-payload handling · reviewed by @jessica_dawson",
        angle: -145,
        radius: 228,
        weight: "secondary"
      },
      {
        id: "services",
        kind: "services",
        label: "3 services",
        sublabel: "direct imports",
        tooltip: "api-gateway · webhook-processor · billing-worker",
        angle: -28,
        radius: 250,
        weight: "primary"
      },
      {
        id: "slack-billing",
        kind: "slack",
        label: "#billing-auth",
        sublabel: "blast radius thread",
        tooltip: "Discussion on empty-payload change · Sep 18",
        angle: 165,
        radius: 215,
        weight: "secondary"
      },
      {
        id: "codeowners",
        kind: "codeowners",
        label: "@jessica_dawson",
        sublabel: "90% blame · 60d",
        tooltip: "Primary owner · Marcus & Elena touch adjacent paths",
        angle: 132,
        radius: 255,
        weight: "secondary"
      },
      {
        id: "jira-1204",
        kind: "jira",
        label: "PROJ-1204",
        sublabel: "Auth hardening epic",
        tooltip: "Parent epic for token validation hardening",
        angle: 42,
        radius: 238,
        weight: "secondary"
      }
    ],
    contextPacket: [
      { id: "graph", source: "Symbol graph", detail: "TokenValidator.validate() · 23 dependents · 3 services" },
      { id: "github", source: "GitHub", detail: "PR #8821 · 8 commits · security-sensitive path", toggleable: true },
      { id: "services", source: "Services", detail: "api-gateway · webhook-processor · billing-worker" },
      { id: "slack", source: "Slack", detail: "#billing-auth · blast radius discussion", toggleable: true },
      { id: "codeowners", source: "Ownership", detail: "@jessica_dawson · 90% blame (60d)" },
      { id: "model", source: "Model", detail: "Routed via BYOK · zero-retention flags" }
    ],
    exampleQuestion:
      "If I refactor `TokenValidator.validate()` in `internal/auth/token_validator.ts`, what breaks downstream? List dependents in `api-gateway`, `workers/webhook-processor`, and shared libs.",
    highlights: ["symbol graph dependents", "cross-service impact"]
  },
  {
    id: "graph-consistency",
    feature: "Knowledge Gaps",
    file: {
      name: "GraphConsistencyManager.go",
      path: "internal/graph/",
      language: "Go",
      symbol: "applyEvent()"
    },
    sourceCount: 6,
    orbitNodes: [
      {
        id: "slack-dedupe",
        kind: "slack",
        label: "#platform-indexing",
        sublabel: "webhook dedupe",
        tooltip: "Open thread on event ordering · no linked spec",
        angle: -155,
        radius: 240,
        weight: "primary"
      },
      {
        id: "jira-2102",
        kind: "jira",
        label: "PROJ-2102",
        sublabel: "open · no doc link",
        tooltip: "Webhook dedupe edge cases · missing acceptance criteria",
        angle: -68,
        radius: 252,
        weight: "primary"
      },
      {
        id: "gap-spec",
        kind: "gap",
        label: "Missing spec",
        sublabel: "gap detected",
        tooltip: "No design doc linked to applyEvent() changes",
        angle: 8,
        radius: 268,
        weight: "primary",
        isGap: true
      },
      {
        id: "pr-901",
        kind: "github",
        label: "PR #901",
        sublabel: "partial coverage",
        tooltip: "Tests cover happy path only · dedupe branch untested",
        angle: 88,
        radius: 245,
        weight: "secondary"
      },
      {
        id: "related-handler",
        kind: "graph",
        label: "slackWebhookHandler.ts",
        sublabel: "normalization path",
        tooltip: "@alex modified 4d ago · handlers/slackWebhookHandler.ts",
        angle: 148,
        radius: 228,
        weight: "secondary"
      },
      {
        id: "commits-recent",
        kind: "commits",
        label: "@alex · 4d ago",
        sublabel: "last change",
        tooltip: "Recent change to Slack normalization without doc update",
        angle: -118,
        radius: 198,
        weight: "secondary"
      }
    ],
    contextPacket: [
      { id: "graph", source: "Code graph", detail: "applyEvent() · 9 refs · graph package" },
      { id: "slack", source: "Slack", detail: "#platform-indexing · webhook dedupe thread", toggleable: true },
      { id: "jira", source: "Jira", detail: "PROJ-2102 · open · no linked doc", toggleable: true },
      { id: "gap", source: "Gap", detail: "⚠ No design doc for dedupe branch" },
      { id: "github", source: "GitHub", detail: "PR #901 · partial test coverage", toggleable: true },
      { id: "model", source: "Model", detail: "Routed via BYOK · zero-retention flags" }
    ],
    exampleQuestion:
      "Before I ship changes to `GraphConsistencyManager.applyEvent()`, what am I missing? Any Slack threads or Jira tickets on webhook dedupe?",
    highlights: ["undocumented decisions", "Slack + Jira cross-ref"]
  }
];

export function getFileContextScenario(id: string): FileContextScenario {
  const scenario = FILE_CONTEXT_SCENARIOS.find((s) => s.id === id);
  if (!scenario) {
    throw new Error(`Unknown file context scenario: ${id}`);
  }
  return scenario;
}
