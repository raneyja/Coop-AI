export type QuickActionSource =
  | "graph"
  | "github"
  | "slack"
  | "jira"
  | "notion"
  | "confluence"
  | "codeowners";

export type QuickActionPrompt = {
  id: string;
  /** Slash or CLI-style command shown on the chip */
  command: string;
  /** Short action label next to the command */
  action: string;
  question: string;
  sources: QuickActionSource[];
  /** One-line outcome teaser — not a full answer */
  teaser: string;
};

export const SOURCE_LABELS: Record<QuickActionSource, string> = {
  graph: "Symbol graph",
  github: "GitHub",
  slack: "Slack",
  jira: "Jira",
  notion: "Notion",
  confluence: "Confluence",
  codeowners: "CODEOWNERS"
};

/** Homepage prompt carousel — breadth of asks across stack + write surfaces */
export const QUICK_ACTION_PROMPTS: QuickActionPrompt[] = [
  {
    id: "understand-repo",
    command: "/understand",
    action: "Understand Repo",
    question:
      "I'm onboarding to `coop-backend` — where does webhook ingestion start, and how do events flow into the job queue vs `GraphCache`? What are the 5 files I should read first?",
    sources: ["graph", "github", "codeowners"],
    teaser: "Start at webhook ingress → queue → GraphCache · 5-file read order"
  },
  {
    id: "trace-decision",
    command: "/trace",
    action: "Trace Decision",
    question:
      "Why did we add zero-retention headers on `auth_middleware.go`? Pull the Slack thread, Jira ticket, and the design note that led to this pattern.",
    sources: ["slack", "jira", "github", "confluence"],
    teaser: "#platform-auth · PROJ-1847 · Auth RFC v2 — pattern chosen for incident #inc-auth-992"
  },
  {
    id: "find-owner",
    command: "/owner",
    action: "Find Owner",
    question:
      "Who owns `services/billing/invoice_handler.go`? CODEOWNERS says @platform-payments but blame shows @marcus — who should review a change to idempotency keys?",
    sources: ["codeowners", "github", "slack"],
    teaser: "Jessica Dawson · 90% blame · loop in @marcus_vance for auth routing"
  },
  {
    id: "blast-radius",
    command: "/blast",
    action: "Blast Radius",
    question:
      "If I refactor `TokenValidator.validate()` in `internal/auth/token_validator.ts`, what breaks downstream across `api-gateway` and `workers/webhook-processor`?",
    sources: ["graph", "github", "slack"],
    teaser: "23 dependents · 6 repos · signature changes break api-gateway + webhook-processor"
  },
  {
    id: "knowledge-gaps",
    command: "/gaps",
    action: "Knowledge Gaps",
    question:
      "Before I ship changes to `GraphConsistencyManager.applyEvent()`, what am I missing — any Slack threads or Jira on webhook dedupe?",
    sources: ["slack", "jira", "github", "graph"],
    teaser: "Undocumented dedupe path · last Slack thread 40d ago · no Jira for edge retries"
  },
  {
    id: "slack",
    command: "/slack",
    action: "Ask Slack",
    question:
      "Summarize the `#billing-auth` threads about empty-payload handling and link them to the commits that shipped the fix.",
    sources: ["slack", "github"],
    teaser: "3 threads · Sep empty-payload discussion · tied to PR #842"
  },
  {
    id: "jira",
    command: "/jira",
    action: "Ask Jira",
    question:
      "Can you fix this bug by looking at PLATFORM-2847 — null check missing in the webhook auth path?",
    sources: ["jira", "github", "graph", "slack"],
    teaser: "Add null guard before validate() · match api-gateway PR #891 pattern"
  },
  {
    id: "edit-selection",
    command: "/edit",
    action: "Edit selection",
    question:
      "Select the refresh-token branch in `oauth_refresh.ts` and match rejection semantics from `token_validator.ts` — throw `AuthError('empty_or_unsigned_payload')`.",
    sources: ["graph", "github"],
    teaser: "Inline diff ready · AuthError guard matched · Tab to accept"
  }
];
