import assert from "node:assert/strict";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  decisionSourceLabelCommit,
  decisionSourceLabelJira,
  decisionSourceLabelPr,
  decisionSourceLabelSlack,
  decisionSourceLabelTeams,
  listDecisionSourceLabels,
  listDecisionSourcesChecklist
} from "./decisionSourceLabels";

const timeline: DecisionTimeline = {
  file: "src/retry.ts",
  completeness: "partial",
  originalCommit: {
    sha: "abc123def456",
    author: "dev@acme.com",
    date: "2024-01-01T00:00:00Z",
    message: "Add retry logic",
    htmlUrl: "https://github.com/acme/widgets/commit/abc123def456"
  },
  linkedPR: {
    number: 1506,
    title: "Retry policy",
    state: "merged",
    description: "Adds retries",
    htmlUrl: "https://github.com/acme/widgets/pull/1506",
    approvers: ["alice"],
    labels: [],
    reviews: []
  },
  slackThread: {
    channelId: "C123",
    channelName: "engineering",
    threadTs: "1700000000.0001",
    participants: ["alice"],
    messages: [{ user: "alice", text: "Ship with backoff", ts: "1700000000" }]
  },
  teamsThread: {
    teamId: "T1",
    channelId: "C456",
    rootMessageId: "msg-1",
    participants: ["bob"],
    messages: [{ user: "bob", text: "Approved", date: "2024-01-01T00:00:00Z" }]
  },
  jiraTickets: [
    {
      key: "WID-42",
      summary: "Retry policy",
      description: "Backoff required",
      acceptanceCriteria: ["Retries capped"],
      technicalDebt: false,
      htmlUrl: "https://jira/acme/WID-42"
    }
  ],
  alternatives: [],
  chronology: [],
  warnings: ["No Slack thread found in linked PR metadata"]
};

assert.equal(decisionSourceLabelCommit("abc123def456"), "[Sources: GitHub commit abc123d]");
assert.equal(decisionSourceLabelPr(1506), "[Sources: PR #1506]");
assert.equal(decisionSourceLabelSlack("engineering"), "[Sources: Slack #engineering]");
assert.equal(decisionSourceLabelTeams(), "[Sources: Teams thread]");
assert.equal(decisionSourceLabelJira("WID-42"), "[Sources: Jira WID-42]");

const labels = listDecisionSourceLabels(timeline);
assert.equal(labels.length, 5);
assert.ok(labels.includes("[Sources: PR #1506]"));

const checklist = listDecisionSourcesChecklist(timeline);
assert.equal(checklist.length, labels.length);
assert.ok(checklist.some((line) => line.includes("PR description, review comments")));
assert.ok(checklist.some((line) => line.includes("ticket requirements, acceptance criteria")));
assert.ok(checklist.some((line) => line.includes("introducing commit and message — provenance")));
assert.ok(checklist.every((line) => line.includes(" — ")));
assert.ok(!checklist.some((line) => line.includes("No Slack thread")));

const withTitleOnlyDocs: DecisionTimeline = {
  ...timeline,
  integrationSearch: {
    notion: {
      pages: [{ id: "1", title: "ADR COOP-55" }]
    },
    googleDocs: {
      documents: [{ id: "2", title: "Design doc" }]
    },
    confluence: {
      pages: [{ id: "3", title: "Architecture", excerpt: "Retries", htmlUrl: "https://confluence/3" }]
    }
  }
};
const titleOnlyLabels = listDecisionSourceLabels(withTitleOnlyDocs);
assert.ok(titleOnlyLabels.some((label) => label.includes("Confluence")));
assert.ok(!titleOnlyLabels.some((label) => label.includes("Notion")));
assert.ok(!titleOnlyLabels.some((label) => label.includes("Google Docs")));

const confluenceTitleOnly: DecisionTimeline = {
  ...timeline,
  integrationSearch: {
    confluence: {
      pages: [{ id: "4", title: "No excerpt page", htmlUrl: "https://confluence/4" }]
    }
  }
};
assert.ok(!listDecisionSourceLabels(confluenceTitleOnly).some((label) => label.includes("Confluence")));

console.log("decisionSourceLabels: ok");
