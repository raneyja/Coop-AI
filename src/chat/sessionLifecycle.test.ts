import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";

function run(): void {
  const titles: string[] = [];
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    disposed: true,
    options: { onTitleChange: (title: string) => titles.push(title) }
  }) as CoopChatSession;

  (session as unknown as { setThreadTitle(title: string): void }).setThreadTitle("late title");
  assert.deepEqual(titles, [], "late async title updates must not touch a disposed webview panel");
  console.log("sessionLifecycle: 1/1 tests passed");
}

run();
