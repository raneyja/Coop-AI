import assert from "node:assert/strict";
import test from "node:test";
import { fetchJiraSearchContext, type JiraSearchTicket } from "./jiraContext";
import { openHitsByIds } from "../api/integrations/openHitsByIds";
import type { IntegrationProxy } from "../api/integrations/integrationOperations";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { JiraIssue } from "../api/jira/jiraClient";
import type { ResolvedIntegrationScope } from "../integrationScope/types";

const stale = "SYNTHETIC_PREVIOUSLY_AUTHORIZED_BODY";
const scope: ResolvedIntegrationScope = { provider: "atlassian", enforced: true, allowed: true, scopeStatus: "active",
  atlassian: { jiraProjectIds: ["P1"], jiraProjectKeys: ["APP"], jiraProjectNames: ["App"],
    confluenceSpaceIds: [], confluenceSpaceKeys: [], confluenceSpaceNames: [] } };
const cached: JiraSearchTicket = { key: "APP-1", summary: "Cached", status: "Open", issueType: "Task", updated: "2026-10-11",
  htmlUrl: "https://fixture.atlassian.net/browse/APP-1", description: stale };
const fresh: JiraIssue = { key: "APP-1", summary: "Fresh", description: "CURRENT_AUTHORIZED_BODY", status: "Open", issueType: "Task",
  acceptanceCriteria: [], labels: [], technicalDebt: false, created: "2026-10-12", updated: "2026-10-12", htmlUrl: cached.htmlUrl };
function secrets(proxy: IntegrationProxy): IntegrationSecrets {
  return { getCredentials: async () => ({ proxy }) } as IntegrationSecrets;
}
function request(proxy: IntegrationProxy) {
  return { secrets: secrets(proxy), owner: "fixture", repo: "fixture", jobScoped: true,
    openIds: ["APP-1"], existingHits: { issues: [cached, { ...cached, key: "APP-2" }] }, integrationScope: scope };
}
test("denied organization open returns no cached body or opened marker", async () => {
  let calls = 0;
  const proxy: IntegrationProxy = async () => { calls++; throw new Error("Authorization changed."); };
  const result = await fetchJiraSearchContext(request(proxy));
  assert.equal(calls, 1); assert.deepEqual(result.issues, []);
  assert.match(result.error!, /no longer authorized/); assert.ok(!JSON.stringify(result).includes(stale));
});
test("organization cached open requires a freshly enforced allowed scope before calling proxy", async () => {
  let calls = 0;
  const proxy: IntegrationProxy = async () => { calls++; return fresh as never; };
  for (const integrationScope of [undefined, { ...scope, enforced: false }, { ...scope, allowed: false }]) {
    const result = await fetchJiraSearchContext({ ...request(proxy), integrationScope });
    assert.deepEqual(result.issues, []); assert.ok(result.error);
  }
  assert.equal(calls, 0);
});
test("authorized organization open replaces cached body and returns only the selected source", async () => {
  const calls: string[] = [];
  const proxy: IntegrationProxy = async (operation, args) => {
    calls.push(operation); assert.equal(operation, "jira.getIssue"); assert.deepEqual(args, ["APP-1"]); return fresh as never;
  };
  const result = await fetchJiraSearchContext(request(proxy));
  assert.deepEqual(calls, ["jira.getIssue"]); assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.summary, "Fresh"); assert.equal(result.issues[0]!.description, fresh.description);
  assert.equal(result.issues[0]!.opened, true); assert.ok(!JSON.stringify(result).includes(stale));
});
test("foreign identity from open is not admitted as the selected organization source", async () => {
  const proxy: IntegrationProxy = async () => ({ ...fresh, key: "OTHER-1" }) as never;
  const result = await fetchJiraSearchContext(request(proxy));
  assert.deepEqual(result.issues, []); assert.ok(result.error);
});
test("missing selected ID cannot release unselected cached organization rows", async () => {
  let calls = 0;
  const proxy: IntegrationProxy = async () => { calls++; return fresh as never; };
  const result = await fetchJiraSearchContext({ ...request(proxy), openIds: ["APP-999"] });
  assert.deepEqual(result.issues, []); assert.equal(calls, 0);
});
test("legacy explicit local client retains its existing failure-row behavior", async () => {
  const result = await fetchJiraSearchContext({ ...request(async () => fresh as never),
    client: { getIssue: async () => { throw new Error("local unavailable"); }, searchIssues: async () => [] } });
  assert.equal(result.issues[0]?.description, stale);
});
test("failClosed helper rejects foreign identity and never keeps failed rows", async () => {
  const options = { hits: [{ id: "A", body: stale }, { id: "B", body: stale }], ids: ["A"], idOf: (hit: { id: string }) => hit.id, failClosed: true };
  await assert.rejects(openHitsByIds({ ...options, openOne: async () => { throw new Error("denied"); } }), /denied/);
  await assert.rejects(openHitsByIds({ ...options, openOne: async () => ({ id: "B", body: "fresh" }) }), /identity changed/);
  assert.deepEqual(await openHitsByIds({ ...options, openOne: async () => ({ id: "a", body: "fresh" }) }), [{ id: "a", body: "fresh" }]);
});
