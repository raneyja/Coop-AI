import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSharedInitialization } from "./sessionInitialization";
import { shouldAcceptHistory } from "../webview/lib/chatHydration";

async function run(): Promise<void> {
  let releasePreferences!: () => void;
  const preferences = new Promise<void>((resolve) => { releasePreferences = resolve; });
  let identity = "provisional-thread";
  let calls = 0;
  let refreshIdentityDirectory!: () => void;
  const identityDirectory = new Promise<void>((resolve) => { refreshIdentityDirectory = resolve; });
  let directoryRefreshed = false;
  const initialize = createSharedInitialization(async () => {
    calls++;
    await preferences;
    identity = "signed-in-thread";
    // A remote identity-directory refresh does not gate local history.
    void identityDirectory.then(() => { directoryRefreshed = true; });
  });
  const first = initialize();
  const ready = initialize();
  assert.equal(first, ready, "webview-ready shares initialization already in flight");
  let sentThread: string | undefined;
  const postInitialHistory = ready.then(() => { sentThread = identity; });
  let refreshPreviousIdentity: string | undefined;
  const refresh = (async () => {
    await initialize();
    refreshPreviousIdentity = identity;
  })();
  await Promise.resolve();
  assert.equal(sentThread, undefined, "provisional identity is never posted while preferences load");
  releasePreferences();
  await Promise.all([first, postInitialHistory, refresh]);
  assert.equal(refreshPreviousIdentity, "signed-in-thread", "concurrent preferences refresh captures the hydrated account rather than a provisional identity");
  assert.equal(calls, 1);
  assert.equal(sentThread, "signed-in-thread");
  assert.equal(directoryRefreshed, false, "local history is available before remote identity-directory refresh");
  assert.equal(shouldAcceptHistory({ threadId: sentThread, messages: [], artifacts: [] }, "signed-in-thread", 0), true);
  refreshIdentityDirectory();
  await identityDirectory;
  assert.equal(await initialize(), undefined);
  assert.equal(calls, 1, "subsequent readiness does not rehydrate or reset thread history");

  const sessionSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "CoopChatSession.ts"),
    "utf8"
  );
  const hydrationGuard = sessionSource.indexOf("if (!this.sessionHydrated)");
  const editorStamp = sessionSource.indexOf("this.stampLiveEditorSelection(editor", hydrationGuard);
  assert.ok(hydrationGuard >= 0, "editor refresh must have a startup hydration guard");
  assert.ok(editorStamp > hydrationGuard, "pre-hydration calls must return before stamping editor context");

  console.log("startup identity hydration checks passed");
}
void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
