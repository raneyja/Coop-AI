import assert from "node:assert/strict";
import { quoteTeamsQueryTerm, shouldFetchTeamsContext, wantsTeamsContext, buildTeamsSearchQueries } from "./teamsContext";
import { teamsSearchHitsFromGraph } from "../api/teams/teamsClient";
import type { ContextFetchRequest } from "./requestBatcher";

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

test("wantsTeamsContext matches explicit teams questions", () => {
  assert.equal(wantsTeamsContext("any teams threads for this repo?"), false);
  assert.equal(wantsTeamsContext("microsoft teams discussion about auth"), true);
  assert.equal(wantsTeamsContext("What is the auth flow?"), false);
  assert.equal(
    wantsTeamsContext("search slack for discussions about this file"),
    false,
    "Slack-only discussion asks must not imply Teams"
  );
});

test("job-scoped Teams search quotes terms so hyphen and not are not operators", () => {
  const queries = buildTeamsSearchQueries({
    extraTerms: ["SQL-injection", "not to mix"],
    jobScoped: true
  });
  assert.deepEqual(queries, ['"SQL-injection"', '"not to mix"']);
  assert.equal(quoteTeamsQueryTerm('say "hi"'), '"say hi"');
});

test("Teams search reads hitsContainers instead of the request row", () => {
  const hits = teamsSearchHitsFromGraph(
    {
      value: [
        {
          hitsContainers: [
            {
              hits: [
                {
                  hitId: "hit-1",
                  summary: "Do not mix",
                  resource: {
                    id: "msg-1",
                    channelIdentity: { teamId: "team", channelId: "chan" },
                    body: { content: "<p>Do not mix this into the SQL-injection PR.</p>" }
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    5
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.messageId, "msg-1");
  assert.match(hits[0]?.body ?? "", /Do not mix/);
});

test("shouldFetchTeamsContext skips Teams while it is coming soon", () => {
  const request = {
    type: "chat_context",
    params: {},
    intent: {
      context: { queryText: "board sync webhook failures — any retries last week?" }
    }
  } as ContextFetchRequest;
  assert.equal(shouldFetchTeamsContext(request), false);
  assert.equal(wantsTeamsContext("board sync webhook failures — any retries last week?"), false);
});

test("shouldFetchTeamsContext skips knowledge-gaps while Teams is coming soon", () => {
  const request = {
    type: "knowledge_gaps",
    params: { quickAction: "knowledge-gaps" }
  } as ContextFetchRequest;
  assert.equal(shouldFetchTeamsContext(request), false);
});

const total = passed + failed;
console.log(`\nteamsContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
