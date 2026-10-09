import assert from "node:assert/strict";
import { agentTurnAction, agentTurnAllowsRepoTools, integrationsForAgentLoop, shouldRunAgentToolLoop } from "./agentRouting";
import { planRawChatAskFromRules } from "./intentPlanner/frontDoor";
import { openFileOwnsExplainAsk, semanticAttachModeForChat } from "./plainChatExplain";
import { repoFileScopeAllowsPath, requestedRepoFiles, resolveRepoFileScope } from "../api/agent/requestedRepoFiles";
import type { IntegrationChatProvider } from "./types";
import { emptyChatIntentPlan } from "./intentPlanner/types";
import type { ContextFetchRequest } from "../context/requestBatcher";
import { shouldFetchSlackContext } from "../context/slackContext";
import { shouldFetchJiraContext } from "../context/jiraContext";
import { shouldFetchTeamsContext } from "../context/teamsContext";
import { shouldFetchNotionContext } from "../context/notionContext";
import { shouldFetchConfluenceContext } from "../context/confluenceContext";
import { shouldFetchGoogleDocsContext } from "../context/googleDocsContext";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${String(error)}`); }
}

const connected: IntegrationChatProvider[] = ["slack", "jira", "teams", "notion", "confluence", "google-docs"];
const original = "Using only the selected CoopAI-Corp/documenso repository context, list two concrete rules from its root AGENTS.md. Then state the value of appDirectory in /apps/remix/react-router.config.ts.";

for (const [query, expected] of [
  ["Read /src/a.ts but do not read /src/b.ts.", ["src/a.ts"]],
  ["Read /src/a.ts; don't quote or use /src/b.ts and /src/c.ts. Then read /src/d.ts.", ["src/a.ts", "src/d.ts"]],
  ["Read /src/a.ts excluding /src/b.ts and /src/c.ts.", ["src/a.ts"]],
  ["Read /src/a.ts without reading /src/b.ts, then read /src/d.ts.", ["src/a.ts", "src/d.ts"]],
  ["Read /src/a.ts except /src/b.ts; quote /src/d.ts.", ["src/a.ts", "src/d.ts"]],
  ["Don't read /src/b.ts or /src/c.ts. Read /src/a.ts.", ["src/a.ts"]],
  ["Avoid reading /src/b.ts, and quote /src/a.ts.", ["src/a.ts"]],
  ["Don't read and quote /src/b.ts or /src/c.ts; read /src/a.ts.", ["src/a.ts"]],
  ["Read /src/a.ts, but do not use `src/b.ts`; quote /src/d.ts.", ["src/a.ts", "src/d.ts"]],
  ["Read /src/a.ts but not /src/b.ts; read /src/d.ts.", ["src/a.ts", "src/d.ts"]],
  ["Read /src/a.ts, not /src/b.ts or /src/c.ts.", ["src/a.ts"]],
  ["Don't use beta.ts, describe alpha.ts.", ["alpha.ts"]],
  ["Don't use beta.ts and state the export in alpha.ts.", ["alpha.ts"]],
  ["Read /src/alpha.ts, no /src/beta.ts.", ["src/alpha.ts"]],
  ["Read /src/alpha.ts, no /src/beta.ts, describe /src/gamma.ts.", ["src/alpha.ts", "src/gamma.ts"]],
  ["List project guidelines but do not read root AGENTS.md.", []]
] as Array<[string, string[]]>) {
  test(`excluded file references never become requirements: ${query}`, () => {
    assert.deepEqual(requestedRepoFiles(query).map(file => file.requestedPath), expected);
  });
}

test("explicit root exclusions preserve distinct nested and case-sensitive paths", () => {
  const scope = resolveRepoFileScope("Read /src/a.ts; do not read /config.ts.");
  assert.equal(repoFileScopeAllowsPath(scope, "config.ts"), false);
  assert.equal(repoFileScopeAllowsPath(scope, "./config.ts"), false);
  assert.equal(repoFileScopeAllowsPath(scope, "apps/api/config.ts"), true);
  assert.equal(repoFileScopeAllowsPath(scope, "Config.ts"), true);
});

test("bare basename exclusions apply to every matching path", () => {
  const scope = resolveRepoFileScope("Read /src/a.ts without using private.ts or AGENTS.md.");
  for (const path of ["private.ts", "apps/api/private.ts", "AGENTS.md", "apps/api/AGENTS.md"]) {
    assert.equal(repoFileScopeAllowsPath(scope, path), false);
  }
  assert.equal(repoFileScopeAllowsPath(scope, "apps/api/Private.ts"), true);
});

test("negative-sounding path segments and prose do not exclude actual requested files", () => {
  const query = "Read /src/exclude/config.ts and /src/without/mapping.ts; explain why an empty value is not accepted.";
  assert.deepEqual(resolveRepoFileScope(query).excludedFiles, []);
  assert.deepEqual(requestedRepoFiles(query).map(file => file.requestedPath), ["src/exclude/config.ts", "src/without/mapping.ts"]);
});

test("separate exclusions keep the positive command between them available", () => {
  const query = "Read /src/a.ts; do not read /src/b.ts, and use /src/c.ts without quoting /src/d.ts.";
  assert.deepEqual(requestedRepoFiles(query).map(file => file.requestedPath), ["src/a.ts", "src/c.ts"]);
  const scope = resolveRepoFileScope(query);
  assert.equal(repoFileScopeAllowsPath(scope, "src/b.ts"), false);
  assert.equal(repoFileScopeAllowsPath(scope, "src/c.ts"), true);
  assert.equal(repoFileScopeAllowsPath(scope, "src/d.ts"), false);
});

test("occurrence-specific exactness keeps basename discovery when only its root path is excluded", () => {
  for (const rootRef of ["/config.ts", "./config.ts"]) {
    const query = `Read config.ts, but do not read ${rootRef}.`;
    assert.deepEqual(requestedRepoFiles(query), [{ requestedPath: "config.ts", exact: false }]);
    const scope = resolveRepoFileScope(query);
    assert.equal(repoFileScopeAllowsPath(scope, "config.ts"), false);
    assert.equal(repoFileScopeAllowsPath(scope, "apps/api/config.ts"), true);
  }
});

test("root and nested explicit positives retain exactness independently of a bare excluded basename", () => {
  assert.deepEqual(requestedRepoFiles("Read /config.ts and /apps/api/Config.ts but don't use config.ts."), [
    { requestedPath: "apps/api/Config.ts", exact: true }
  ]);
  assert.deepEqual(requestedRepoFiles("Read /config.ts and /apps/api/config.ts but don't use /apps/api/config.ts."), [
    { requestedPath: "config.ts", exact: true }
  ]);
});

test("bare no requires an immediate filename rather than negated semantic prose", () => {
  const query = "Explain /src/alpha.ts; there is no evidence in /src/beta.ts.";
  assert.deepEqual(resolveRepoFileScope(query).excludedFiles, []);
});

for (const query of [
  "Read /.gitignore and /.dockerignore. List an ignore pattern present only in .gitignore.",
  "Explain the ignore patterns in .gitignore.",
  "Do not use classes in /src/alpha.ts; explain /src/alpha.ts.",
  "Explain why we avoid classes in /src/alpha.ts.",
  "Describe whether the function can exclude invalid values in /src/alpha.ts."
]) {
  test(`semantic negative vocabulary does not exclude source objects: ${query}`, () => {
    assert.deepEqual(resolveRepoFileScope(query).excludedFiles, []);
  });
}

test("file-command exclusions stop after their actual filename list", () => {
  const query = "Read /src/alpha.ts. Do not use /src/private.ts because /src/alpha.ts has the public API.";
  assert.deepEqual(requestedRepoFiles(query).map(file => file.requestedPath), ["src/alpha.ts"]);
  assert.equal(repoFileScopeAllowsPath(resolveRepoFileScope(query), "src/alpha.ts"), true);
  assert.equal(repoFileScopeAllowsPath(resolveRepoFileScope(query), "src/private.ts"), false);
});

for (const filename of ["ignore.ts", "omit.ts", "without.md", "avoid.ts", "exclude.ts", "no.ts"]) {
  test(`a negative cue inside a filename remains an ordinary source: ${filename}`, () => {
    const query = `Read ${filename} and beta.ts.`;
    assert.deepEqual(resolveRepoFileScope(query).excludedFiles, []);
    assert.deepEqual(requestedRepoFiles(query).map(file => file.requestedPath), [filename, "beta.ts"]);
  });
}
function allowed(query: string, tools = connected): IntegrationChatProvider[] {
  return integrationsForAgentLoop({
    query,
    connected,
    plan: { ...emptyChatIntentPlan(query), mode: "tools-only", tools }
  });
}
function request(query: string, quickAction?: string, inferred = true): ContextFetchRequest {
  return {
    type: "chat_context",
    params: { quickAction, fetchIntegrations: inferred ? connected : undefined },
    intent: { context: { queryText: query } }
  } as ContextFetchRequest;
}
const fetchers = [
  ["slack", shouldFetchSlackContext], ["jira", shouldFetchJiraContext],
  ["teams", shouldFetchTeamsContext], ["notion", shouldFetchNotionContext],
  ["confluence", shouldFetchConfluenceContext], ["google-docs", shouldFetchGoogleDocsContext]
] as const;

for (const query of [
  original,
  original.replace("appDirectory", "ssr"),
  "From only the selected `CoopAI-Corp/documenso` repository, explain /apps/remix/react-router.config.ts.",
  "Answer using repository-only evidence from AGENTS.md; do not search Slack or Jira.",
  "Using only the selected repository context, explain whether the config mentions Slack or Jira."
]) {
  test(`repo-only scope blocks inferred and merely mentioned tools: ${query}`, () => {
    assert.deepEqual(allowed(query), []);
    for (const [provider, shouldFetch] of fetchers) {
      assert.equal(shouldFetch(request(query, "knowledge-gaps")), false, `${provider} initial gather`);
      assert.equal(shouldFetch(request(query, "trace-decision")), false, `${provider} quick-action backfill`);
    }
  });
}

for (const query of [
  "Read src/auth.ts; do not search Slack or Jira.",
  "Read src/auth.ts without searching Slack or Jira.",
  "Read src/auth.ts. Don't use Slack or Jira."
]) {
  test(`negative tool mentions cannot authorize the tools: ${query}`, () => {
    assert.deepEqual(allowed(query, ["slack", "jira"]), []);
    assert.equal(shouldFetchSlackContext(request(query)), false);
    assert.equal(shouldFetchJiraContext(request(query)), false);
    assert.equal(shouldFetchSlackContext(request(query, undefined, false)), false);
    assert.equal(shouldFetchJiraContext(request(query, undefined, false)), false);
  });
}

test("excluding Slack preserves an explicitly requested Jira source", () => {
  const query = "Read src/auth.ts and search Jira for COOP-101, but do not search Slack.";
  assert.deepEqual(allowed(query, ["slack", "jira"]), ["jira"]);
  assert.equal(shouldFetchSlackContext(request(query)), false);
  assert.equal(shouldFetchJiraContext(request(query)), true);
});

test("explicit mixed repository and connected integrations remain available", () => {
  const query = "Read src/auth.ts and search Slack and Jira for the auth extraction decision.";
  assert.deepEqual(allowed(query, ["slack", "jira"]), ["slack", "jira"]);
  assert.equal(shouldFetchSlackContext(request(query)), true);
  assert.equal(shouldFetchJiraContext(request(query)), true);
  assert.equal(shouldFetchSlackContext(request(query, undefined, false)), true);
  assert.equal(shouldFetchJiraContext(request(query, undefined, false)), true);
});

test("positive Jira request after a same-clause Slack exclusion remains available", () => {
  const query = "Read src/auth.ts without searching Slack, and search Jira for COOP-101.";
  assert.deepEqual(allowed(query, ["slack", "jira"]), ["jira"]);
  assert.equal(shouldFetchSlackContext(request(query)), false);
  assert.equal(shouldFetchJiraContext(request(query)), true);
  assert.equal(shouldFetchSlackContext(request(query, undefined, false)), false);
  assert.equal(shouldFetchJiraContext(request(query, undefined, false)), true);
});

test("captured repo-only scope survives a rewritten architecture request and forced integration provider", () => {
  for (const [provider, shouldFetch] of fetchers) {
    const rewritten = request("Architecture Overview", "knowledge-gaps");
    rewritten.params.sourceScope = { repositoryOnly: true, excludedIntegrations: [] };
    rewritten.params.integrationProvider = provider;
    assert.equal(shouldFetch(rewritten), false, `${provider} cannot override captured source scope`);
  }
});

for (const query of [
  "Use no integrations. Read root AGENTS.md and list two concrete rules.",
  "Do not use integrations. Read root AGENTS.md and list two concrete rules."
]) {
  test(`all-integration exclusion applies at both planner and fetch boundaries: ${query}`, () => {
    assert.deepEqual(allowed(query), []);
    for (const [provider, shouldFetch] of fetchers) {
      const planned = request(query, "knowledge-gaps");
      planned.params.integrationProvider = provider;
      assert.equal(shouldFetch(planned), false, `${provider} cannot bypass the explicit integration exclusion`);
    }
  });
}

test("an ordinary positive integration request still reaches connected Slack and Jira", () => {
  const query = "Use integrations to search Slack and Jira for the auth extraction decision.";
  assert.deepEqual(allowed(query, ["slack", "jira"]), ["slack", "jira"]);
  assert.equal(shouldFetchSlackContext(request(query)), true);
  assert.equal(shouldFetchJiraContext(request(query)), true);
});

for (const query of [
  original,
  original.replace("appDirectory", "ssr"),
  "Using only the selected CoopAI-Corp/documenso repository context, list two concrete rules from its root AGENTS.md.",
  "List two project guidelines and state appDirectory in /apps/remix/react-router.config.ts.",
  "Explain root AGENTS.md and state appDirectory in /apps/remix/react-router.config.ts."
]) {
  for (const file of [undefined, "apps/remix/react-router.config.ts"]) {
    test(`actual front door permits requested source evidence with ${file ? "config chip" : "no chip"}: ${query}`, () => {
      const { plan } = planRawChatAskFromRules(query, {
        useRepo: "CoopAI-Corp/documenso", activeFile: file, connectedTools: connected
      });
      const options = { query, hasQuickAction: false, intentPlan: plan, file };
      assert.equal(agentTurnAction(options), "understand");
      assert.equal(shouldRunAgentToolLoop(options), true);
      assert.equal(agentTurnAllowsRepoTools({ query, intentPlan: plan }), true);
    });
  }
}

for (const mode of ["plain", "none", "tools-only"] as const) {
  test(`named-file evidence survives a ${mode} planner without code intent`, () => {
    const intentPlan = { ...emptyChatIntentPlan(original), mode, tools: mode === "tools-only" ? ["slack" as const] : [],
      codeIntent: { action: "none" as const, confidence: "high" as const, reason: "planner treated request as prose" } };
    const options = { query: original, hasQuickAction: false, intentPlan, file: "apps/remix/react-router.config.ts" };
    assert.equal(agentTurnAction(options), "understand");
    assert.equal(shouldRunAgentToolLoop(options), true);
    assert.equal(agentTurnAllowsRepoTools(options), true);
    assert.deepEqual(integrationsForAgentLoop({ query: original, connected, plan: intentPlan }), []);
  });
}

test("requested-file routing still respects the local-file assistant boundary", () => {
  const { plan } = planRawChatAskFromRules(original, {
    useRepo: "CoopAI-Corp/documenso", connectedTools: connected
  });
  const options = { query: original, hasQuickAction: false, intentPlan: plan, fileAssistant: true };
  assert.equal(agentTurnAction(options), "none");
  assert.equal(shouldRunAgentToolLoop(options), false);
});

test("requested-file routing keeps quick actions on their own gathering path", () => {
  const { plan } = planRawChatAskFromRules(original, {
    useRepo: "CoopAI-Corp/documenso", connectedTools: connected, quickAction: "knowledge-gaps"
  });
  const options = { query: original, hasQuickAction: true, intentPlan: plan };
  assert.equal(agentTurnAction(options), "none");
  assert.equal(shouldRunAgentToolLoop(options), false);
});

test("integration slash routing keeps repository tools unavailable", () => {
  const query = `/slack ${original}`;
  const { plan } = planRawChatAskFromRules(query, {
    useRepo: "CoopAI-Corp/documenso", connectedTools: connected
  });
  const options = { query, hasQuickAction: false, intentPlan: plan, integrationSlash: true };
  assert.equal(agentTurnAction(options), "understand");
  assert.equal(agentTurnAllowsRepoTools(options), false);
});

test("a config chip cannot own a compound explanation requesting root instructions", () => {
  const query = "Explain root AGENTS.md and state appDirectory in /apps/remix/react-router.config.ts.";
  const file = "apps/remix/react-router.config.ts";
  assert.equal(openFileOwnsExplainAsk(query, file), false);
  assert.equal(semanticAttachModeForChat({ query, openFile: file }), "bodies");
});

test("a config chip cannot own an explanation requesting a different file", () => {
  const query = "Explain /src/auth.ts.";
  const file = "apps/remix/react-router.config.ts";
  assert.equal(openFileOwnsExplainAsk(query, file), false);
  assert.equal(semanticAttachModeForChat({ query, openFile: file }), "bodies");
});

test("a same-chip simple explanation retains isolated file ownership", () => {
  const file = "apps/remix/react-router.config.ts";
  for (const query of ["Explain this file.", "Explain /apps/remix/react-router.config.ts.", "Explain react-router.config.ts."]) {
    assert.equal(openFileOwnsExplainAsk(query, file), true);
    assert.equal(semanticAttachModeForChat({ query, openFile: file }), "paths-only");
    assert.equal(shouldRunAgentToolLoop({ query, file, hasQuickAction: false }), false);
  }
});

console.log(`\nrepoSourceScope: ${passed}/${passed + failed} tests passed`);
if (failed) process.exitCode = 1;
