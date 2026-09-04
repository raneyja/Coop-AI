import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chatRequiresSignIn } from "./chatAuthGate";

test("chatRequiresSignIn waits for settings:state before gating", () => {
  assert.equal(chatRequiresSignIn(undefined), false);
  assert.equal(chatRequiresSignIn(true), false);
  assert.equal(chatRequiresSignIn(false), true);
});

test("ChatPanel swaps the homepage for a sign-in prompt when signed out", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const chat = fs.readFileSync(path.join(repoRoot, "webview/ChatPanel.tsx"), "utf8");
  const session = fs.readFileSync(path.join(repoRoot, "chat/CoopChatSession.ts"), "utf8");
  assert.match(chat, /chatRequiresSignIn/);
  assert.match(chat, /ChatSignedOutHome/);
  assert.match(session, /syncSurfacesAfterAuthChange/);
});
