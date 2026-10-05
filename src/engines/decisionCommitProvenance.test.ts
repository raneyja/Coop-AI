import assert from "node:assert/strict";
import { DecisionArchaeologyEngine, type TraceDecisionOptions } from "./decisionArchaeology";
import type { DecisionTimeline } from "../types/decisionTimeline";
import { buildDecisionSynthesisUserPrompt, decisionTimelineSummary } from "../prompts/decisionSynthesis";

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const timeline: DecisionTimeline = {
    file: "src/mathRenamed.ts",
    originalCommit: { sha: "rename-sha", author: "fixture-author", date: "2026-10-04", message: "Seed renamed fixture oracle" },
    alternatives: [], chronology: [], warnings: [], completeness: "minimal"
  };
  const engine = new DecisionArchaeologyEngine({
    codeHostRouter: { getCommitBySha: async () => ({ filesChanged: ["src/caller.ts", "src/mathRenamed.ts"] }) },
    codeHostSecrets: { getCredentials: async () => ({ githubToken: "fixture-token" }) }
  } as unknown as TraceDecisionOptions);
  const coords = { provider: "github" as const, owner: "fixture", repo: "repo", branch: "renamed" };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      stats: { additions: 2, deletions: 2 },
      files: [
        { filename: "src/caller.ts", status: "modified" },
        { filename: "src/mathRenamed.ts", status: "renamed", previous_filename: "src/math.ts", patch: '@@ -7,5 +7,5 @@ export function positiveSum(values: number[]): number {\n }\n export function fixtureBranchLabel(): string {\n-  return "main-oracle";\n+  return "renamed-oracle";\n }' }
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    await (engine as unknown as {
      enrichIntroducingDiffSummary: (timeline: DecisionTimeline, targetCoords: typeof coords, file: string, commit: NonNullable<DecisionTimeline["originalCommit"]>) => Promise<void>;
    }).enrichIntroducingDiffSummary(timeline, coords, timeline.file, timeline.originalCommit!);
    assert.deepEqual(timeline.introducingDiffSummary?.fileChange, { type: "renamed", previousPath: "src/math.ts" });
    assert.match(timeline.introducingDiffSummary?.summary ?? "", /Sampled commit changed 2 files/);
    assert.ok(timeline.warnings.some(warning => /does not establish/.test(warning)));
    const prompt = buildDecisionSynthesisUserPrompt({ timeline, file: timeline.file, userFocus: "What introduced positiveSum?" });
    assert.match(prompt, /Target file change: renamed from src\/math.ts/);
    assert.match(prompt, /original introduction/);
    assert.doesNotMatch(prompt, /Originally introduced|Introducing commit changed|as birth\/background/);
    assert.equal(decisionTimelineSummary(timeline), "sampled commit rename-");
    console.log("decisionCommitProvenance: remote rename diff and assembled prompt passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error); process.exit(1); });
