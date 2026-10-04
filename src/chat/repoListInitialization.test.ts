import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";

async function run(): Promise<void> {
  let finishInitialization!: () => void;
  const initialization = new Promise<void>((resolve) => { finishInitialization = resolve; });
  const messages: Array<{ payload: { loading?: boolean; error?: string; items: Array<{ path: string }> } }> = [];
  let listCalls = 0;
  let signedIn = true;
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: {},
    preferences: { defaultCodeHost: "github", apiBaseUrl: "https://api.example.test" },
    initialize: () => initialization,
    options: { api: {
      hasToken: async () => signedIn,
      getWorkspaceRepos: async () => {
        listCalls++;
        return { repos: [{ repoId: "gitlab:fixture/project", owner: "fixture", name: "project", defaultBranch: "preview" }] };
      }
    } },
    postRepoExplorer: (message: typeof messages[number]) => { messages.push(message); }
  });
  const pending = session.handleRepoListRepos("chat");
  await Promise.resolve();
  assert.equal(listCalls, 0, "cold repo loading waits for shared authentication/preferences hydration");
  finishInitialization();
  await pending;
  assert.equal(listCalls, 1);
  assert.equal(messages[0].payload.loading, true);
  assert.equal(messages.at(-1)?.payload.items[0]?.path, "gitlab:fixture/project", "authenticated indexed repo survives initial load");

  signedIn = false;
  await session.handleRepoListRepos("chat");
  assert.equal(listCalls, 1, "signed-out loading does not request workspace repositories");
  assert.match(messages.at(-1)?.payload.error ?? "", /sign in/i);
  assert.deepEqual(messages.at(-1)?.payload.items, []);
  session.initialize = async () => { throw new Error("Authentication initialization failed"); };
  await session.handleRepoListRepos("chat");
  assert.equal(listCalls, 1);
  assert.match(messages.at(-1)?.payload.error ?? "", /initialization failed/);
  assert.equal(messages.at(-1)?.payload.loading, undefined);
  console.log("repoListInitialization: 3/3 passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
