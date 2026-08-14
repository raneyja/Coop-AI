/**
 * Golden repo — a small, polyglot, deliberately noisy repository used to measure
 * hunt accuracy end to end.
 *
 * It exists because our tests used to assert that a string appeared in a source
 * file. That proves nothing about whether Coop finds the right code. Here the
 * question goes through the real query extraction, search, ranking, and read
 * window, and we check the file and line that come out.
 *
 * The fixture imitates an index: real line numbers, real declaration sites, and
 * plenty of near misses (barrels, vendored copies, build output, prose) so that
 * ranking has to do actual work.
 */
import { UNKNOWN_HIT_LINE } from "../../../indexing/graphSearchHit";
import type { IndexBackend } from "../../../indexing/indexBackend";
import type { LocalSearchResult, ScipSymbol, ZoektSearchHit } from "../../../indexing/types";

export const GOLDEN_REPO_ID = "acme/golden";

/**
 * Real files are long. Definitions sit far below the top, so an agent that reads
 * the opening of a file learns nothing — which is exactly how the 2026-08-13
 * answer was produced. Each source below is pushed down by this much filler.
 */
const FILLER_LINES: Record<string, number> = {
  "server/auth/middleware.py": 180,
  "server/auth/tokens.py": 240,
  "server/billing/invoice_service.py": 160,
  "web/components/auth/login-form.tsx": 200,
  "web/hooks/use-session.ts": 150,
  "web/lib/api-client.ts": 320,
  "packages/ui/src/button.tsx": 140,
  "services/gateway/router.go": 260,
  "services/gateway/health.go": 175,
  "core/src/main/java/com/acme/PaymentProcessor.java": 210
};

function commentToken(path: string): string {
  return /\.py$/.test(path) ? "#" : "//";
}

function withFiller(path: string, source: string): string {
  const count = FILLER_LINES[path] ?? 0;
  if (count === 0) {
    return source;
  }
  const token = commentToken(path);
  const filler = Array.from({ length: count }, (_, i) => `${token} legacy helper ${i + 1}`);
  return `${filler.join("\n")}\n${source}`;
}

const SOURCES: Record<string, string> = {
  "server/auth/middleware.py": [
    '"""Request authentication."""',
    "import logging",
    "",
    "logger = logging.getLogger(__name__)",
    "",
    "",
    "class AuthenticationMiddleware:",
    "    def __init__(self, get_response):",
    "        self.get_response = get_response",
    "",
    "    def __call__(self, request):",
    "        return self.get_response(request)",
    "",
    "",
    "def require_auth(view):",
    "    def wrapper(request, *args, **kwargs):",
    "        if not request.user.is_authenticated:",
    "            raise PermissionError('login required')",
    "        return view(request, *args, **kwargs)",
    "",
    "    return wrapper"
  ].join("\n"),

  "server/auth/tokens.py": [
    "import jwt",
    "",
    "",
    "def verify_token(raw):",
    "    return jwt.decode(raw, verify=True)",
    "",
    "",
    "def issue_token(user_id):",
    "    return jwt.encode({'sub': user_id})"
  ].join("\n"),

  "server/billing/invoice_service.py": [
    "from decimal import Decimal",
    "",
    "",
    "class InvoiceService:",
    "    def total(self, lines):",
    "        return sum(Decimal(line.amount) for line in lines)"
  ].join("\n"),

  "web/components/auth/login-form.tsx": [
    'import { useSession } from "../../hooks/use-session";',
    "",
    "export function LoginForm() {",
    "  const session = useSession();",
    "  return <form aria-label=\"login\">{session.email}</form>;",
    "}"
  ].join("\n"),

  "web/hooks/use-session.ts": [
    'import { ApiClient } from "../lib/api-client";',
    "",
    "export function useSession() {",
    "  return new ApiClient().currentUser();",
    "}"
  ].join("\n"),

  "web/lib/api-client.ts": [
    "export class ApiClient {",
    "  public currentUser() {",
    "    return { email: \"\" };",
    "  }",
    "}"
  ].join("\n"),

  "packages/ui/src/index.ts": [
    'export * from "./button";',
    'export * from "./card";'
  ].join("\n"),

  "packages/ui/src/button.tsx": [
    "export function Button(props: { label: string }) {",
    "  return <button>{props.label}</button>;",
    "}"
  ].join("\n"),

  "services/gateway/router.go": [
    "package gateway",
    "",
    'import "net/http"',
    "",
    "func NewRouter() *http.ServeMux {",
    "\tmux := http.NewServeMux()",
    "\treturn mux",
    "}"
  ].join("\n"),

  "services/gateway/health.go": [
    "package gateway",
    "",
    'import "net/http"',
    "",
    "func HealthCheck(w http.ResponseWriter, r *http.Request) {",
    "\tw.WriteHeader(http.StatusOK)",
    "}"
  ].join("\n"),

  "core/src/main/java/com/acme/PaymentProcessor.java": [
    "package com.acme;",
    "",
    "public class PaymentProcessor {",
    "    public void charge(long cents) {}",
    "}"
  ].join("\n"),

  // --- Noise that must never win ---
  "node_modules/authlib/index.js": [
    "function requireAuth(req, res, next) {",
    "  return next();",
    "}",
    "module.exports = { requireAuth };"
  ].join("\n"),

  "dist/bundle.min.js": "function requireAuth(){};function useSession(){};function Button(){}",

  "docs/architecture.md": [
    "# Architecture",
    "",
    "Requests pass through require_auth before reaching a view.",
    "The LoginForm calls useSession, which calls ApiClient."
  ].join("\n")
};

/** The repository as the index sees it: real files, definitions well below the top. */
export const GOLDEN_REPO_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCES).map(([path, source]) => [path, withFiller(path, source)])
);

/** Declaration syntax per language. Stands in for what SCIP gives us for real. */
const DECLARATION_PATTERNS: RegExp[] = [
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/,
  /^\s*export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/
];

function declarationsIn(path: string, body: string): ScipSymbol[] {
  const symbols: ScipSymbol[] = [];
  body.split("\n").forEach((line, index) => {
    for (const pattern of DECLARATION_PATTERNS) {
      const name = line.match(pattern)?.[1];
      if (name) {
        symbols.push({
          symbol: name,
          kind: /class/.test(line) ? "class" : "function",
          file: path,
          line: index + 1,
          character: 0,
          displayName: name
        });
        break;
      }
    }
  });
  return symbols;
}

export function goldenRepoSymbols(): ScipSymbol[] {
  return Object.entries(GOLDEN_REPO_FILES).flatMap(([path, body]) => declarationsIn(path, body));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Text matches with real line numbers, ranked the way a text index would. */
function textHits(query: string): ZoektSearchHit[] {
  const needle = normalize(query);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
  const hits: ZoektSearchHit[] = [];

  for (const [path, body] of Object.entries(GOLDEN_REPO_FILES)) {
    body.split("\n").forEach((line, index) => {
      const flat = normalize(line);
      const lower = line.toLowerCase();
      let score = 0;
      if (needle && flat.includes(needle)) {
        score = 0.9;
      } else if (terms.length > 0 && terms.every((term) => lower.includes(term))) {
        score = 0.6;
      } else if (terms.some((term) => lower.includes(term))) {
        score = 0.3;
      }
      if (score > 0) {
        hits.push({
          fileName: path,
          lineNumber: index + 1,
          content: line,
          score,
          source: "zoekt"
        });
      }
    });
  }

  return hits.sort((left, right) => right.score - left.score).slice(0, 25);
}

function symbolHits(query: string): ScipSymbol[] {
  const needle = normalize(query);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
  return goldenRepoSymbols().filter((symbol) => {
    const name = normalize(symbol.symbol);
    if (needle && (name.includes(needle) || needle.includes(name))) {
      return true;
    }
    return terms.some((term) => name.includes(term));
  });
}

/**
 * How much the index tells us about a match.
 *  - `positioned`: line-level matches, like Zoekt at full fidelity.
 *  - `paths-only`: the file matched but not where — what the hosted graph search
 *    returns for many queries. Accuracy here depends entirely on the symbol
 *    index; guessing a position is what produced the 2026-08-13 answer.
 */
export type GoldenIndexFidelity = "positioned" | "paths-only";

export function goldenRepoSearch(
  query: string,
  fidelity: GoldenIndexFidelity = "positioned"
): LocalSearchResult {
  const symbols = symbolHits(query);
  const hits = textHits(query);
  if (fidelity === "paths-only") {
    const seen = new Set<string>();
    const pathHits = hits
      .filter((hit) => !seen.has(hit.fileName) && seen.add(hit.fileName))
      .map((hit) => ({ ...hit, lineNumber: UNKNOWN_HIT_LINE, content: hit.fileName }));
    return { source: "fallback", hits: pathHits, symbols, stale: false };
  }
  return {
    source: symbols.length > 0 ? "scip" : "zoekt",
    hits,
    symbols,
    stale: false
  };
}

export function createGoldenIndexBackend(
  fidelity: GoldenIndexFidelity = "positioned"
): IndexBackend {
  const ready = {
    repoId: GOLDEN_REPO_ID,
    enabled: true,
    status: "ready" as const,
    lastIndexedAt: undefined,
    error: undefined
  };
  return {
    kind: "local",
    isEnabledForRepo: async () => true,
    enableRepo: async () => ready,
    disableRepo: async () => undefined,
    refreshRepo: async () => ready,
    getRepoStatus: async () => ready,
    listRepoStatuses: async () => [ready],
    search: async (_repoId: string, pattern: string) => goldenRepoSearch(pattern, fidelity),
    dependents: async (_repoId: string, file: string) => ({
      file,
      dependents: [],
      source: "remote" as const
    }),
    summarize: async () => ({
      enabledRepos: 1,
      totalDiskBytes: 0,
      readyRepos: 1,
      indexingRepos: 0
    })
  };
}

export async function readGoldenRepoFile(path: string): Promise<{ path: string; content: string }> {
  return { path, content: GOLDEN_REPO_FILES[path] ?? "" };
}
