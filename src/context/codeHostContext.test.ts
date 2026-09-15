import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCodeHostFilterTerms,
  fetchCodeHostSearchContext,
  wantsCodeHostContext
} from "./codeHostContext";

test("wantsCodeHostContext matches pull request questions", () => {
  assert.equal(wantsCodeHostContext("any open pull requests for this repo?"), true);
  assert.equal(wantsCodeHostContext("What is the auth flow?"), false);
});

test("wantsCodeHostContext matches github issue questions", () => {
  assert.equal(wantsCodeHostContext("list github issues for this repository"), true);
});

test("wantsCodeHostContext matches PR numbers", () => {
  assert.equal(wantsCodeHostContext("what happened in PR #42?"), true);
});

test("wantsCodeHostContext does not treat a topical PR mention as MR search", () => {
  assert.equal(wantsCodeHostContext("did we mix this into the SQL-injection PR?"), false);
  assert.equal(wantsCodeHostContext("Find the issue in the authentication middleware"), false);
  assert.equal(wantsCodeHostContext("search gitlab merge requests"), true);
  assert.equal(wantsCodeHostContext("list GitLab issues for authentication"), true);
  assert.equal(wantsCodeHostContext("list bitbucket pull requests for this repo"), true);
});

test("code-host terms filter real provider results and preserve PR numbers", async () => {
  const listCalls: string[] = [];
  const context = await fetchCodeHostSearchContext({
    router: {
      listRepoPullRequests: async (coords: { provider: string }) => {
        listCalls.push(coords.provider);
        return [
          {
            number: 53,
            title: "Repair auth rollback handling",
            state: "open",
            merged: false,
            updatedAt: "2026-09-12"
          },
          {
            number: 54,
            title: "Unrelated settings cleanup",
            state: "open",
            merged: false,
            updatedAt: "2026-09-12"
          }
        ];
      },
      listRepoIssues: async () => [],
      getPullRequestDetail: async () => {
        throw new Error("detail not needed for filter-only assert");
      }
    } as never,
    provider: "gitlab",
    owner: "acme",
    repo: "app",
    queryText: "PR #53 auth"
  });

  assert.deepEqual(listCalls, ["gitlab"]);
  assert.deepEqual(context.prNumberHits, [53]);
  assert.deepEqual(context.pullRequests.map((pr) => pr.number), [53]);
  assert.deepEqual(extractCodeHostFilterTerms("search bitbucket pull requests for auth"), ["auth"]);
});

test("code-host PR number hit opens description body", async () => {
  const opened: number[] = [];
  const context = await fetchCodeHostSearchContext({
    router: {
      listRepoPullRequests: async () => [
        {
          number: 42,
          title: "Auth change",
          state: "merged",
          merged: true,
          updatedAt: "2026-09-12"
        }
      ],
      listRepoIssues: async () => [],
      getPullRequestDetail: async (n: number) => {
        opened.push(n);
        return {
          number: 42,
          title: "Auth change",
          body: "Chose GitHub App over PAT.",
          state: "closed",
          merged: true,
          createdAt: "2026-09-01",
          updatedAt: "2026-09-12",
          labels: []
        };
      }
    } as never,
    provider: "github",
    owner: "acme",
    repo: "app",
    queryText: "what happened in PR #42?"
  });
  assert.deepEqual(opened, [42]);
  assert.match(context.pullRequests[0]?.body ?? "", /GitHub App/);
  assert.equal(context.pullRequests[0]?.bodyOpened, true);
});
