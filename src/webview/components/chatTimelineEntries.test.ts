import test from "node:test";
import assert from "node:assert/strict";
import { buildTimelineEntries, type TimelineArtifact, type TimelineMessage } from "./chatTimelineEntries";

function msg(
  role: TimelineMessage["role"],
  timestamp: number,
  content: string,
  relatedArtifactId?: string
): TimelineMessage {
  return { role, content, timestamp, relatedArtifactId };
}

function art(id: string, timestamp: number): TimelineArtifact {
  return { id, timestamp };
}

test("multi-tool Sources cards sit above the assistant answer, not at the bottom", () => {
  const messages = [
    msg("user", 100, "search slack and notion"),
    msg("assistant", 400, "Here is what I found", "evidence-notion")
  ];
  const artifacts = [art("evidence-slack", 200), art("evidence-notion", 300)];

  const entries = buildTimelineEntries(messages, artifacts);
  assert.deepEqual(
    entries.map((e) => (e.type === "message" ? `msg:${e.message.role}` : `art:${e.artifact.id}`)),
    ["msg:user", "art:evidence-slack", "art:evidence-notion", "msg:assistant"]
  );
});

test("orphaned Sources card still attaches to the turn when relatedArtifactId is missing", () => {
  const messages = [msg("user", 100, "search slack"), msg("assistant", 300, "No hits")];
  const artifacts = [art("evidence-slack", 200)];

  const entries = buildTimelineEntries(messages, artifacts);
  assert.deepEqual(
    entries.map((e) => (e.type === "message" ? `msg:${e.message.role}` : `art:${e.artifact.id}`)),
    ["msg:user", "art:evidence-slack", "msg:assistant"]
  );
});
