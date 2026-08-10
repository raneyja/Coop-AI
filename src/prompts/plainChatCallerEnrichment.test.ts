import assert from "node:assert/strict";
import {
  enrichPlainChatCallerResponse,
  plainChatClaimsCallersUnknown
} from "./plainChatCallerEnrichment";
import { buildUserMessageWithContext } from "./systemPrompts";
import { mergeDurableDependentsIntoContextData } from "../engines/blastRadiusDependentsFallback";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("mergeDurableDependentsIntoContextData promotes import-parse callers", () => {
  const merged = mergeDurableDependentsIntoContextData(
    { file: "src/config/responseDeadline.ts", status: "dependency-graph-requested" },
    {
      dependents: [
        { path: "src/chat/CoopChatSession.ts", depth: 1, source: "import-parse" },
        { path: "src/engines/blastRadiusAnalysis.ts", depth: 1, source: "import-parse" },
        { path: "src/config/responseDeadline.test.ts", depth: 1, source: "import-parse" }
      ],
      source: "import-parse",
      warnings: ["Dependents from durable import-parse graph — 3 direct caller(s)."]
    }
  );
  assert.equal((merged.directDependents as string[]).length, 3);
  assert.ok((merged.directDependents as string[]).includes("src/chat/CoopChatSession.ts"));
  assert.equal((merged.graphMeta as { source: string }).source, "import-parse");
});

test("buildUserMessageWithContext emits file_dependents for caller asks", () => {
  const message = buildUserMessageWithContext("What does this file do, and who calls it?", {
    owner: "raneyja",
    repo: "Coop-AI",
    file: "src/config/responseDeadline.ts",
    contextBundle: [
      {
        requestId: "t:dependencies:0",
        type: "dependencies",
        data: {
          file: "src/config/responseDeadline.ts",
          directDependents: [
            "src/chat/CoopChatSession.ts",
            "src/engines/blastRadiusAnalysis.ts",
            "src/jobs/executors.ts"
          ],
          graphMeta: { source: "import-parse" }
        },
        fetchedAt: new Date()
      }
    ]
  });
  assert.ok(message.includes("<file_dependents"));
  assert.ok(message.includes('source="import-parse"'));
  assert.ok(message.includes("src/chat/CoopChatSession.ts"));
  assert.ok(message.includes("Do not say callers are unknown"));
});

test("enrichPlainChatCallerResponse injects callers when model claims unknown", () => {
  assert.equal(
    plainChatClaimsCallersUnknown(
      "This file sets soft gather budgets. Exact callers are not specified in the attached context."
    ),
    true
  );
  const enriched = enrichPlainChatCallerResponse(
    "This file sets soft gather budgets. Exact callers are not specified in the attached context.",
    {
      file: "src/config/responseDeadline.ts",
      directDependents: [
        "src/chat/CoopChatSession.ts",
        "src/engines/blastRadiusAnalysis.ts",
        "src/config/responseDeadline.test.ts"
      ],
      graphMeta: { source: "import-parse" }
    }
  );
  assert.ok(enriched.includes("**Callers (import-parse)**"));
  assert.ok(enriched.includes("src/chat/CoopChatSession.ts"));
  assert.ok(enriched.includes("src/engines/blastRadiusAnalysis.ts"));
});

test("enrichPlainChatCallerResponse is a no-op when callers already named", () => {
  const input =
    "Callers include `src/chat/CoopChatSession.ts` and `src/engines/blastRadiusAnalysis.ts`.";
  const enriched = enrichPlainChatCallerResponse(input, {
    file: "src/config/responseDeadline.ts",
    directDependents: ["src/chat/CoopChatSession.ts", "src/engines/blastRadiusAnalysis.ts"],
    graphMeta: { source: "import-parse" }
  });
  assert.equal(enriched, input);
});

console.log(`\nplainChatCallerEnrichment: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
