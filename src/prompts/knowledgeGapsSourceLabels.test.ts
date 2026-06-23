import assert from "node:assert/strict";
import {
  knowledgeGapsSourceLabelJira,
  knowledgeGapsSourceLabelTeams,
  listKnowledgeGapsSourceLabels,
  listKnowledgeGapsSourcesChecklist
} from "../prompts/knowledgeGapsSourceLabels";

const labels = listKnowledgeGapsSourceLabels(
  { jobScan: { gaps: [] }, warnings: ["Commit history unavailable: 400"] },
  { pages: [{ title: "Architecture" }] },
  { issues: [] },
  { messages: [] },
  undefined,
  undefined,
  { messages: [], error: "Microsoft Teams token not configured." }
);

assert.ok(labels.includes("[Sources: Knowledge gap scan]"));
assert.ok(labels.includes("[Sources: Confluence pages]"));
assert.ok(!labels.includes(knowledgeGapsSourceLabelJira()));
assert.ok(!labels.includes(knowledgeGapsSourceLabelTeams()));

const checklist = listKnowledgeGapsSourcesChecklist(
  { jobScan: { gaps: [] }, warnings: ["PR review data unavailable: 400"] },
  { pages: [{ title: "Architecture" }] },
  { issues: [], error: "Jira search failed" },
  { messages: [] },
  undefined,
  undefined,
  { messages: [], error: "Microsoft Teams token not configured." }
);

assert.ok(checklist.some((line) => line.includes("[Sources: Knowledge gap scan]")));
assert.ok(checklist.some((line) => line.includes("[Sources: Confluence pages]")));
assert.ok(!checklist.some((line) => line.includes("[Sources: Warning]")));
assert.ok(!checklist.some((line) => line.includes("Teams token")));
assert.ok(!checklist.some((line) => line.includes("No Jira issues")));

console.log("knowledgeGapsSourceLabels: ok");
