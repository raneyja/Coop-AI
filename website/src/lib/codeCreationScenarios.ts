import type { CodeToken } from "@/lib/productMockScenarios";
import type { StorySearchStep } from "@/lib/fileContextStoryScenarios";

export type CodeEditorLine = {
  n: number;
  tokens: CodeToken[];
  highlight?: boolean;
  diffRemove?: boolean;
  diffAdd?: boolean;
};

type CodeCreationStoryBase = {
  id: string;
  feature: string;
  activeTab: string;
  inactiveTab?: string;
  ariaLabel: string;
  /** User prompt in sidebar — same role as inquiry `question` */
  question: string;
  searchSteps: StorySearchStep[];
  /** Brief CoopAI reply after context gather, before editor outcome */
  outcome: { content: string };
  contextHint: string;
};

export type CompleteStory = CodeCreationStoryBase & {
  kind: "complete";
  lines: CodeEditorLine[];
  cursorLine: number;
  typedPrefix: string;
  ghostSuffix: string;
};

export type EditStory = CodeCreationStoryBase & {
  kind: "edit";
  instruction: string;
  lines: CodeEditorLine[];
  selectionStart: number;
  selectionEnd: number;
};

export type CodeCreationStory = CompleteStory | EditStory;

export const CODE_CREATION_STORIES: CodeCreationStory[] = [
  {
    kind: "complete",
    id: "inline-complete",
    feature: "Inline complete",
    activeTab: "token_validator.ts",
    inactiveTab: "session_store.go",
    ariaLabel:
      "CoopAI inline completion finishing an empty-payload guard using graph-informed AuthError patterns",
    question:
      "Complete the empty-payload guard in `token_validator.ts` — use the same AuthError pattern as billing/auth. Graph shows 3 downstream callers.",
    searchSteps: [
      {
        id: "graph",
        label: "Symbol graph",
        detail: "validateSession() · AuthError usages",
        kind: "graph"
      },
      {
        id: "github",
        label: "GitHub · billing/auth",
        detail: "AuthError('empty_or_unsigned_payload')",
        kind: "github"
      },
      {
        id: "callers",
        label: "Dependents",
        detail: "3 callers require matching guard",
        kind: "graph"
      }
    ],
    outcome: {
      content: `**Completion ready**

Matched \`AuthError\` guard from \`billing/auth\` — 3 downstream callers import this path. Ghost text applied at your cursor.`
    },
    contextHint: "graph · 3 callers · AuthError pattern",
    lines: [
      {
        n: 1,
        tokens: [
          { t: "keyword", v: "import" },
          { t: "plain", v: " { AuthError } " },
          { t: "keyword", v: "from" },
          { t: "string", v: " './errors'" },
          { t: "plain", v: ";" }
        ]
      },
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
      { n: 4, tokens: [{ t: "comment", v: "  // Validates signature before route handlers" }] }
    ],
    cursorLine: 5,
    typedPrefix: "  if (!payload?.signature",
    ghostSuffix: " || !payload?.exp) {\n    throw new AuthError('empty_or_unsigned_payload');\n  }"
  },
  {
    kind: "edit",
    id: "edit-selection",
    feature: "Edit selection",
    activeTab: "oauth_refresh.ts",
    inactiveTab: "token_validator.ts",
    ariaLabel:
      "CoopAI editing a selected OAuth refresh branch to match team rejection semantics from token_validator.ts",
    question:
      "Edit this selection in `oauth_refresh.ts` — match rejection semantics from `token_validator.ts`. Throw AuthError instead of returning null.",
    searchSteps: [
      {
        id: "graph",
        label: "Symbol graph",
        detail: "refreshOAuthToken() · auth/oauth",
        kind: "graph"
      },
      {
        id: "github",
        label: "GitHub · token_validator.ts",
        detail: "AuthError empty-payload branch",
        kind: "github"
      },
      {
        id: "pattern",
        label: "Pattern match",
        detail: "billing/auth rejection semantics",
        kind: "graph"
      }
    ],
    outcome: {
      content: `**Edit ready**

Pulled rejection semantics from \`token_validator.ts\`. Review the inline diff — accept, retry, or undo in the editor.`
    },
    instruction: "match token_validator.ts rejection semantics",
    contextHint: "graph · oauth_refresh · billing/auth",
    lines: [
      {
        n: 1,
        tokens: [
          { t: "keyword", v: "async function" },
          { t: "plain", v: " " },
          { t: "fn", v: "refreshOAuthToken" },
          { t: "plain", v: "(session: Session) {" }
        ]
      },
      {
        n: 2,
        tokens: [
          { t: "plain", v: "  " },
          { t: "keyword", v: "const" },
          { t: "plain", v: " payload = await " },
          { t: "fn", v: "buildRefreshPayload" },
          { t: "plain", v: "(session);" }
        ]
      },
      {
        n: 3,
        diffRemove: true,
        tokens: [
          { t: "plain", v: "  " },
          { t: "keyword", v: "if" },
          { t: "plain", v: " (!payload) " },
          { t: "keyword", v: "return" },
          { t: "plain", v: " null;" }
        ]
      },
      {
        n: 4,
        diffAdd: true,
        tokens: [
          { t: "plain", v: "  " },
          { t: "keyword", v: "if" },
          { t: "plain", v: " (!payload?.refreshToken || !payload?.exp) {" }
        ]
      },
      {
        n: 5,
        diffAdd: true,
        tokens: [
          { t: "plain", v: "    " },
          { t: "keyword", v: "throw new" },
          { t: "type", v: " AuthError" },
          { t: "plain", v: "('empty_or_unsigned_payload');" }
        ]
      },
      {
        n: 6,
        diffAdd: true,
        tokens: [{ t: "plain", v: "  }" }]
      },
      {
        n: 7,
        tokens: [
          { t: "plain", v: "  " },
          { t: "keyword", v: "return" },
          { t: "fn", v: " exchangeToken" },
          { t: "plain", v: "(payload);" }
        ]
      },
      { n: 8, tokens: [{ t: "plain", v: "}" }] }
    ],
    selectionStart: 3,
    selectionEnd: 3
  }
];
