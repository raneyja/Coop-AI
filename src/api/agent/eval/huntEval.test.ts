/**
 * Hunt accuracy eval.
 *
 * Each case runs the real agent loop against the golden repo and asks two
 * questions a user would ask:
 *   1. did it read the right file?
 *   2. did the text it read actually contain the definition?
 *
 * (2) is the one that would have caught the 2026-08-13 miss, where Coop cited
 * plausible files but had only read their first 26 lines.
 */
import assert from "node:assert/strict";
import { createAgentOrchestrator } from "../AgentOrchestrator";
import {
  GOLDEN_REPO_FILES,
  GOLDEN_REPO_ID,
  type GoldenIndexFidelity,
  createGoldenIndexBackend,
  readGoldenRepoFile
} from "./goldenRepo";
import { COPILOT_C1_ASK, COPILOT_C2_ASK } from "../dogfoodContract";

type HuntCase = {
  question: string;
  expectFile: string;
  /** Exact source line that answers the question. */
  expectLine: string;
};

const CASES: HuntCase[] = [
  {
    question: "Where is requireAuth or authentication middleware defined in this repo?",
    expectFile: "server/auth/middleware.py",
    expectLine: "def require_auth(view):"
  },
  {
    question: "Where is verify_token defined in this repo?",
    expectFile: "server/auth/tokens.py",
    expectLine: "def verify_token(raw):"
  },
  {
    question: "Where is the InvoiceService class defined?",
    expectFile: "server/billing/invoice_service.py",
    expectLine: "class InvoiceService:"
  },
  {
    question: "Where is the LoginForm component defined in this repo?",
    expectFile: "web/components/auth/login-form.tsx",
    expectLine: "export function LoginForm() {"
  },
  {
    question: "Where is useSession defined in this repo?",
    expectFile: "web/hooks/use-session.ts",
    expectLine: "export function useSession() {"
  },
  {
    question: "Where is the ApiClient class defined?",
    expectFile: "web/lib/api-client.ts",
    expectLine: "export class ApiClient {"
  },
  {
    question: "Where is the Button component defined in this repo?",
    expectFile: "packages/ui/src/button.tsx",
    expectLine: "export function Button(props: { label: string }) {"
  },
  {
    question: "Where is NewRouter defined in this repo?",
    expectFile: "services/gateway/router.go",
    expectLine: "func NewRouter() *http.ServeMux {"
  },
  {
    question: "Where is HealthCheck defined in this repo?",
    expectFile: "services/gateway/health.go",
    expectLine: "func HealthCheck(w http.ResponseWriter, r *http.Request) {"
  },
  {
    question: "Where is PaymentProcessor defined in this repo?",
    expectFile: "core/src/main/java/com/acme/PaymentProcessor.java",
    expectLine: "public class PaymentProcessor {"
  },
  {
    question: "Where is issue_token defined in this repo?",
    expectFile: "server/auth/tokens.py",
    expectLine: "def issue_token(user_id):"
  },
  {
    question: "Where is the AuthenticationMiddleware class defined?",
    expectFile: "server/auth/middleware.py",
    expectLine: "class AuthenticationMiddleware:"
  },
  {
    question: COPILOT_C1_ASK,
    expectFile: "server/http/bearer.py",
    expectLine: "def parse_authorization_header(headers):"
  },
  {
    question: COPILOT_C2_ASK,
    expectFile: "apps/api/issues/work_item_state.py",
    expectLine: "def write_work_item_state(item, new_state):"
  }
];

const NEVER_READ = [
  /^node_modules\//,
  /^dist\//,
  /\/index\.ts$/,
  /\/locales?\//,
  /\/i18n\//,
  /\/db\/models\//,
  /\/seeds?\//,
  /openapi\.(py|yml|yaml|json)$/
];

type Outcome = {
  question: string;
  readPaths: string[];
  foundFile: boolean;
  foundLine: boolean;
};

async function runHunt(hunt: HuntCase, fidelity: GoldenIndexFidelity): Promise<Outcome> {
  const readPaths: string[] = [];
  const orchestrator = createAgentOrchestrator({
    indexBackend: createGoldenIndexBackend(fidelity),
    resolveAbsolutePath: () => undefined,
    readRemoteFile: async ({ path }) => {
      readPaths.push(path);
      return readGoldenRepoFile(path);
    }
  });

  const result = await orchestrator.run({ message: hunt.question, repoId: GOLDEN_REPO_ID });
  const readFile = result.context?.read_file as
    | { files?: Array<{ path: string; content: string }> }
    | undefined;
  const files = readFile?.files ?? [];
  const match = files.find((file) => file.path === hunt.expectFile);
  return {
    question: hunt.question,
    readPaths,
    foundFile: Boolean(match),
    foundLine: Boolean(match?.content.includes(hunt.expectLine))
  };
}

async function main(): Promise<void> {
  // Sanity: every expectation must exist in the fixture, or the eval is lying.
  for (const hunt of CASES) {
    const body = GOLDEN_REPO_FILES[hunt.expectFile];
    assert.ok(body, `fixture missing ${hunt.expectFile}`);
    assert.ok(
      body.includes(hunt.expectLine),
      `fixture ${hunt.expectFile} does not contain ${JSON.stringify(hunt.expectLine)}`
    );
  }

  const regimes: Array<{ fidelity: GoldenIndexFidelity; label: string }> = [
    { fidelity: "positioned", label: "index returns match lines" },
    { fidelity: "paths-only", label: "index returns files only" }
  ];

  let allPassed = true;
  for (const regime of regimes) {
    console.log(`\n${regime.label} (${regime.fidelity}):`);
    const outcomes: Outcome[] = [];
    for (const hunt of CASES) {
      outcomes.push(await runHunt(hunt, regime.fidelity));
    }

    const rightFile = outcomes.filter((o) => o.foundFile).length;
    const rightLine = outcomes.filter((o) => o.foundLine).length;
    const noiseReads = [
      ...new Set(
        outcomes.flatMap((o) =>
          o.readPaths.filter((path) => NEVER_READ.some((pattern) => pattern.test(path)))
        )
      )
    ];

    for (const outcome of outcomes) {
      const mark = outcome.foundLine ? "✓" : outcome.foundFile ? "~" : "✗";
      console.log(`  ${mark} ${outcome.question}`);
      if (!outcome.foundLine) {
        console.log(`      read: ${outcome.readPaths.join(", ") || "(nothing)"}`);
      }
    }

    console.log(
      `  R-G1/R-G2 (${regime.fidelity}): right file ${rightFile}/${CASES.length} · definition in view ${rightLine}/${CASES.length}`
    );
    if (noiseReads.length > 0) {
      console.log(`  R-G4 FAIL — read vendored/build/barrel files: ${noiseReads.join(", ")}`);
    }

    // Enterprise bar: 100%. Soft partial credit is a FAIL.
    if (noiseReads.length > 0 || rightFile < CASES.length || rightLine < CASES.length) {
      allPassed = false;
      console.error(
        `  FAIL R-G1..R-G4 (${regime.fidelity}): require ${CASES.length}/${CASES.length} file and definition; got ${rightFile}/${rightLine}`
      );
    } else {
      console.log(`  PASS R-G1 R-G2 R-G3 R-G4 (${regime.fidelity})`);
    }
  }

  assert.ok(allPassed, "hunt eval FAIL — enterprise requires 100% file + definition, zero noise reads");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
