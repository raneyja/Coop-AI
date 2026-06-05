export type CodeToken = {
  t: "keyword" | "fn" | "type" | "string" | "comment" | "plain";
  v: string;
};

export type ProductMockScenario = {
  id: string;
  feature: string;
  question: string;
  ariaLabel: string;
  tabs: { active: string; inactive?: string };
  answer: {
    /** Cursor-style prose — same format as the extension ChatProse renderer */
    content: string;
  };
  code: {
    lines: Array<{ n: number; tokens: CodeToken[]; highlight?: boolean }>;
    callout: { title: string; subtitle: string; detail: string; tone: "violet" | "amber" | "accent" };
  };
};

export const PRODUCT_MOCK_SCENARIOS: ProductMockScenario[] = [
  {
    id: "ownership",
    feature: "Find Owner",
    question:
      "Who owns this token validation block, and who should review a change to empty-payload handling?",
    ariaLabel:
      "CoopAI identifying code ownership and suggested reviewers for token validation",
    tabs: { active: "token_validator.ts", inactive: "auth_routes.go" },
    answer: {
      content: `**Short answer**

Jessica Dawson owns this routine — 90% blame over the last 60 commits on \`token_validator.ts\`. Marcus and Elena touch adjacent auth and schema paths.

**Suggested reviewers**

- \`@marcus_vance\` — auth routing
- \`@elena_rostova\` — downstream DB hooks

**Risk signals**

High blast radius on empty-payload handling. Slack \`#billing-auth\` discussed this in Sep.`
    },
    code: {
      lines: [
        { n: 1, tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " { validateSession } " }, { t: "keyword", v: "from" }, { t: "string", v: " './auth'" }, { t: "plain", v: ";" }] },
        { n: 2, tokens: [] },
        {
          n: 3,
          tokens: [
            { t: "keyword", v: "export" },
            { t: "plain", v: " async function " },
            { t: "fn", v: "validateSession" },
            { t: "plain", v: "(payload: JwtPayload) {" }
          ]
        },
        { n: 4, tokens: [{ t: "comment", v: "  // Validates signature before route handlers" }] },
        {
          n: 5,
          highlight: true,
          tokens: [
            { t: "plain", v: "  " },
            { t: "keyword", v: "if" },
            { t: "plain", v: " (!payload?.signature || !payload?.exp) {" }
          ]
        },
        {
          n: 6,
          highlight: true,
          tokens: [
            { t: "plain", v: "    " },
            { t: "keyword", v: "throw new" },
            { t: "type", v: " AuthError" },
            { t: "plain", v: "('empty_or_unsigned_payload');" }
          ]
        },
        { n: 7, tokens: [{ t: "plain", v: "  }" }] },
        { n: 8, tokens: [{ t: "keyword", v: "  return" }, { t: "fn", v: " validate" }, { t: "plain", v: "(payload);" }] }
      ],
      callout: {
        title: "Jessica Dawson",
        subtitle: "Modified 3d ago · 43 commits (90d)",
        detail: "Impact: 3 dependent files",
        tone: "violet"
      }
    }
  },
  {
    id: "blast-radius",
    feature: "Blast Radius",
    question: "What's the blast radius if we change the retry backoff in payments_queue.go?",
    ariaLabel: "CoopAI analyzing blast radius and dependent services for a payments change",
    tabs: { active: "payments_queue.go", inactive: "ledger_client.ts" },
    answer: {
      content: `**Short answer**

14 files reference \`ProcessRetryBackoff()\`. 3 services import the module directly; 2 public API contracts include the retry envelope.

**Affected services**

- \`api-gateway\` — runtime dependency
- \`billing-worker\` — batch retries
- \`ledger-svc\` — settlement hooks

**Recommendation**

Treat as a **breaking change risk** — staged rollout recommended. Tuned in PR #8821, shared across services.`
    },
    code: {
      lines: [
        { n: 1, tokens: [{ t: "keyword", v: "func" }, { t: "plain", v: " " }, { t: "fn", v: "ProcessRetryBackoff" }, { t: "plain", v: "(attempt int) time.Duration {" }] },
        { n: 2, tokens: [{ t: "plain", v: "  " }, { t: "keyword", v: "if" }, { t: "plain", v: " attempt > maxRetries {" }] },
        { n: 3, tokens: [{ t: "keyword", v: "    return" }, { t: "plain", v: " 0" }] },
        { n: 4, tokens: [{ t: "plain", v: "  }" }] },
        {
          n: 5,
          highlight: true,
          tokens: [
            { t: "comment", v: "  // Tuned in PR #8821 — shared by 3 services" },
          ]
        },
        {
          n: 6,
          highlight: true,
          tokens: [
            { t: "keyword", v: "  return" },
            { t: "plain", v: " time.Duration(math.Pow(2, float64(attempt))) * time.Second" }
          ]
        },
        { n: 7, tokens: [{ t: "plain", v: "}" }] }
      ],
      callout: {
        title: "14 referencing files",
        subtitle: "3 services · 2 API surfaces",
        detail: "Recommend staged rollout",
        tone: "amber"
      }
    }
  },
  {
    id: "reviewers",
    feature: "PR reviewers",
    question: "Who should review this PR for the OAuth token refresh changes?",
    ariaLabel: "CoopAI suggesting reviewers for an OAuth token refresh pull request",
    tabs: { active: "oauth_refresh.ts", inactive: "session_store.go" },
    answer: {
      content: `**Short answer**

Jessica Dawson authored 61% of touched lines in PR #1247. Marcus Vance reviewed adjacent auth routing in the last 30 days.

**Suggested reviewers**

- \`@jessica_dawson\` — primary owner (61% blame)
- \`@marcus_vance\` — 9 files in \`auth/\` (last 30d)
- \`@elena_rostova\` — schema migrations downstream

Security-sensitive OAuth refresh path — include a security reviewer before merge.`
    },
    code: {
      lines: [
        { n: 1, tokens: [{ t: "keyword", v: "async function" }, { t: "fn", v: " refreshOAuthToken" }, { t: "plain", v: "(session: Session) {" }] },
        { n: 2, tokens: [{ t: "plain", v: "  " }, { t: "keyword", v: "const" }, { t: "plain", v: " payload = await " }, { t: "fn", v: "buildRefreshPayload" }, { t: "plain", v: "(session);" }] },
        {
          n: 3,
          highlight: true,
          tokens: [
            { t: "plain", v: "  " },
            { t: "keyword", v: "if" },
            { t: "plain", v: " (!payload.refreshToken) " },
            { t: "keyword", v: "return" },
            { t: "fn", v: " rejectExpired" },
            { t: "plain", v: "(session);" }
          ]
        },
        {
          n: 4,
          highlight: true,
          tokens: [
            { t: "plain", v: "  " },
            { t: "keyword", v: "return" },
            { t: "fn", v: " exchangeToken" },
            { t: "plain", v: "(payload);" }
          ]
        },
        { n: 5, tokens: [{ t: "plain", v: "}" }] }
      ],
      callout: {
        title: "PR #1247",
        subtitle: "3 files · auth/oauth",
        detail: "2 required reviewers",
        tone: "accent"
      }
    }
  },
  {
    id: "understand-repo",
    feature: "Understand Repo",
    question: "Help me understand how auth flows through this repo.",
    ariaLabel: "CoopAI explaining repository architecture and auth flow",
    tabs: { active: "cmd/api/main.go", inactive: "middleware/auth.go" },
    answer: {
      content: `**Short answer**

Auth entry at \`cmd/api\` → \`middleware/auth\` → \`internal/session\`. Token validation lives in \`billing/auth\`; workers call \`ledger_client\` for settlement.

**Key paths**

- \`cmd/api/main.go\` — HTTP entry & route registration
- \`middleware/auth.go\` — session + JWT gate
- \`billing/auth/token_validator.ts\` — signature validation

12k symbols indexed across 4 packages that touch auth.`
    },
    code: {
      lines: [
        { n: 1, tokens: [{ t: "comment", v: "// Auth flow (from graph)" }] },
        { n: 2, tokens: [{ t: "plain", v: "main()" }] },
        { n: 3, tokens: [{ t: "plain", v: "  → " }, { t: "fn", v: "authMiddleware" }, { t: "plain", v: "()" }] },
        {
          n: 4,
          highlight: true,
          tokens: [{ t: "plain", v: "  → " }, { t: "fn", v: "validateSession" }, { t: "plain", v: "()  " }, { t: "comment", v: "// billing/auth" }]
        },
        {
          n: 5,
          highlight: true,
          tokens: [{ t: "plain", v: "  → " }, { t: "fn", v: "ledgerClient.Post" }, { t: "plain", v: "()  " }, { t: "comment", v: "// async" }]
        },
        { n: 6, tokens: [{ t: "plain", v: "  → handlers.*" }] }
      ],
      callout: {
        title: "4 packages",
        subtitle: "Auth spine identified",
        detail: "Zero-clone graph",
        tone: "accent"
      }
    }
  },
  {
    id: "knowledge-gaps",
    feature: "Knowledge Gaps",
    question: "What knowledge gaps exist around the legacy billing adapter?",
    ariaLabel: "CoopAI surfacing knowledge gaps and missing context for legacy billing code",
    tabs: { active: "billing_adapter.ts", inactive: "README.md" },
    answer: {
      content: `**Short answer**

No commits in 14 months; primary owner left the team. Runbook link 404s. Two related Jira tickets remain open without resolution notes.

**Missing context**

- No ADR for v1 → v2 adapter migration
- Incident postmortem references lost Slack thread
- Downstream schema owner unknown

\`billing_adapter.ts\` is tribal-knowledge risk — confirm with platform-payments before changes.`
    },
    code: {
      lines: [
        { n: 1, tokens: [{ t: "comment", v: "// @deprecated — v1 billing bridge" }] },
        {
          n: 2,
          highlight: true,
          tokens: [
            { t: "keyword", v: "export function" },
            { t: "fn", v: " adaptLegacyInvoice" },
            { t: "plain", v: "(raw: unknown) {" }
          ]
        },
        { n: 3, tokens: [{ t: "comment", v: "  // TODO: document edge cases (no owner)" }] },
        {
          n: 4,
          highlight: true,
          tokens: [{ t: "plain", v: "  " }, { t: "keyword", v: "return" }, { t: "fn", v: " mapV1ToV2" }, { t: "plain", v: "(raw as LegacyInvoice);" }]
        },
        { n: 5, tokens: [{ t: "plain", v: "}" }] }
      ],
      callout: {
        title: "14 months idle",
        subtitle: "2 open tickets",
        detail: "Runbook missing",
        tone: "amber"
      }
    }
  },
  {
    id: "integrations",
    feature: "Slack & tickets",
    question: "Show me how this connects to Slack and tickets.",
    ariaLabel: "CoopAI linking code to Slack threads and Jira tickets",
    tabs: { active: "incident_handler.go", inactive: "BILL-4421" },
    answer: {
      content: `**Short answer**

Slack \`#incidents\` thread (Feb 12) discusses payload retries. Jira \`BILL-4421\` tracks the billing outage root cause tied to \`incident_handler.go\`.

**Linked sources**

- Slack \`#incidents\` — 14 messages, 3 engineers
- Jira \`BILL-4421\` — P1 billing outage (resolved)
- PR #1198 — fix merged 2 days after thread`
    },
    code: {
      lines: [
        { n: 1, tokens: [{ t: "keyword", v: "func" }, { t: "plain", v: " " }, { t: "fn", v: "HandleBillingIncident" }, { t: "plain", v: "(evt Event) error {" }] },
        { n: 2, tokens: [{ t: "plain", v: "  ctx := " }, { t: "fn", v: "loadIncidentContext" }, { t: "plain", v: "(evt.ID)" }] },
        {
          n: 3,
          highlight: true,
          tokens: [
            { t: "comment", v: "  // Linked: Slack thread + BILL-4421" }
          ]
        },
        {
          n: 4,
          highlight: true,
          tokens: [
            { t: "plain", v: "  " },
            { t: "keyword", v: "return" },
            { t: "fn", v: " replayWithBackoff" },
            { t: "plain", v: "(evt, ctx.Policy)" }
          ]
        },
        { n: 5, tokens: [{ t: "plain", v: "}" }] }
      ],
      callout: {
        title: "Slack + Jira",
        subtitle: "Thread Feb 12",
        detail: "PR #1198 linked",
        tone: "violet"
      }
    }
  }
];

export function getProductMockScenario(id: string): ProductMockScenario {
  return PRODUCT_MOCK_SCENARIOS.find((s) => s.id === id) ?? PRODUCT_MOCK_SCENARIOS[0];
}
