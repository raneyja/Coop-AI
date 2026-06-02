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
  response: {
    title: string;
    status: string;
    statusTone: "accent" | "warning" | "success" | "violet";
    meta: string;
    summary: string;
    sections?: Array<{ label: string; lines: string[] }>;
    badges?: Array<{ label: string; tone: "amber" | "muted" | "accent" | "violet" }>;
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
    response: {
      title: "Code ownership",
      status: "High confidence",
      statusTone: "accent",
      meta: "billing/auth · token_validator.ts",
      summary:
        "Jessica Dawson owns this routine — 90% blame over the last 60 commits. Marcus and Elena touch adjacent auth and schema paths.",
      sections: [
        {
          label: "Suggested reviewers",
          lines: ["@marcus_vance · auth routing", "@elena_rostova · downstream DB hooks"]
        }
      ],
      badges: [
        { label: "High blast radius", tone: "amber" },
        { label: "Slack #billing-auth", tone: "muted" }
      ]
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
    response: {
      title: "Blast radius",
      status: "High risk",
      statusTone: "warning",
      meta: "payments/core · ProcessRetryBackoff()",
      summary:
        "14 files reference this symbol. 3 services import the module directly; 2 public API contracts include the retry envelope.",
      sections: [
        {
          label: "Affected services",
          lines: ["api-gateway (runtime dep)", "billing-worker (batch retries)", "ledger-svc (settlement hooks)"]
        }
      ],
      badges: [
        { label: "2 external APIs", tone: "amber" },
        { label: "Breaking change risk", tone: "amber" }
      ]
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
    response: {
      title: "Review recommendations",
      status: "Ready",
      statusTone: "success",
      meta: "auth/oauth · PR #1247",
      summary:
        "Jessica Dawson authored 61% of touched lines. Marcus Vance reviewed adjacent auth routing in the last 30 days.",
      sections: [
        {
          label: "Suggested reviewers",
          lines: [
            "@jessica_dawson · primary owner (61% blame)",
            "@marcus_vance · 9 files in auth/ (last 30d)",
            "@elena_rostova · schema migrations downstream"
          ]
        }
      ],
      badges: [{ label: "Security-sensitive path", tone: "violet" }]
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
    response: {
      title: "Repository overview",
      status: "Mapped",
      statusTone: "accent",
      meta: "monorepo · 4 packages touch auth",
      summary:
        "Entry at cmd/api → middleware/auth → internal/session. Token validation lives in billing/auth; workers call ledger_client for settlement.",
      sections: [
        {
          label: "Key paths",
          lines: [
            "cmd/api — HTTP entry & route registration",
            "middleware/auth — session + JWT gate",
            "billing/auth — token_validator.ts"
          ]
        }
      ],
      badges: [{ label: "12k symbols indexed", tone: "muted" }]
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
    response: {
      title: "Knowledge gaps",
      status: "Gaps found",
      statusTone: "warning",
      meta: "billing/legacy · billing_adapter.ts",
      summary:
        "No commits in 14 months; primary owner left the team. Runbook link 404s. Two related Jira tickets remain open without resolution notes.",
      sections: [
        {
          label: "Missing context",
          lines: [
            "No ADR for v1 → v2 adapter migration",
            "Incident postmortem references lost Slack thread",
            "Downstream schema owner unknown"
          ]
        }
      ],
      badges: [
        { label: "Tribal knowledge risk", tone: "amber" },
        { label: "No recent owner", tone: "amber" }
      ]
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
    response: {
      title: "Connected context",
      status: "Linked",
      statusTone: "violet",
      meta: "incidents · incident_handler.go",
      summary:
        "Slack #incidents thread (Feb 12) discusses payload retries. Jira BILL-4421 tracks the billing outage root cause tied to this handler.",
      sections: [
        {
          label: "Sources",
          lines: [
            "Slack #incidents — 14 messages, 3 engineers",
            "Jira BILL-4421 — P1 billing outage (resolved)",
            "PR #1198 — fix merged 2d after thread"
          ]
        }
      ],
      badges: [
        { label: "Slack", tone: "violet" },
        { label: "Jira BILL-4421", tone: "accent" }
      ]
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
