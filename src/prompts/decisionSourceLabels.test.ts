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
  provider: "github",
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

assert.equal(decisionSourceLabelCommit("abc123def456"), "[Sources: Code host commit abc123d]");
assert.equal(decisionSourceLabelCommit("abc123def456", "bitbucket"), "[Sources: Bitbucket commit abc123d]");
assert.equal(decisionSourceLabelPr(1506), "[Sources: PR/MR #1506]");
assert.equal(decisionSourceLabelPr(1506, "github"), "[Sources: PR #1506]");
assert.equal(decisionSourceLabelPr(1506, "gitlab"), "[Sources: MR #1506]");
assert.equal(decisionSourceLabelSlack("engineering"), "[Sources: Slack #engineering]");
assert.equal(decisionSourceLabelTeams(), "[Sources: Teams thread]");
assert.equal(decisionSourceLabelJira("WID-42"), "[Sources: Jira WID-42]");

const labels = listDecisionSourceLabels(timeline);
assert.equal(labels.length, 5);
assert.ok(labels.includes("[Sources: PR #1506]"));

const bitbucketLabels = listDecisionSourceLabels({ ...timeline, provider: "bitbucket" });
assert.ok(bitbucketLabels.includes("[Sources: Bitbucket commit abc123d]"));
assert.ok(bitbucketLabels.includes("[Sources: PR #1506]"));

const checklist = listDecisionSourcesChecklist(timeline);
assert.equal(checklist.length, labels.length);
assert.ok(checklist.some((line) => line.includes("attached description")));
assert.ok(checklist.some((line) => line.includes("attached ticket fields")));
assert.ok(checklist.some((line) => line.includes("sampled commit and message — provenance")));
assert.ok(checklist.every((line) => line.includes(" — ")));
assert.ok(!checklist.some((line) => line.includes("No Slack thread")));

console.log("decisionSourceLabels: ok");

const metadataOnly = { ...timeline, linkedPR: { ...timeline.linkedPR!, description: "", reviews: [] }, integrationSearch: { notion: { pages: [{ id: "n", title: "ADR", url: "https://example/n" }] }, googleDocs: { documents: [{ id: "d", title: "Design", url: "https://example/d" }] } } };
const metadataChecklist = listDecisionSourcesChecklist(metadataOnly);
assert.ok(metadataChecklist.some(line => line.includes("listed approvers")));
assert.ok(!metadataChecklist.some(line => line.includes("attached description") || line.includes("attached review comment")));
assert.ok(metadataChecklist.filter(line => /Notion|Google Docs/.test(line)).every(line => line.includes("bodies not attached") || line.includes("body not attached")));

const focusedTimeline = { ...timeline, focusCommit: { ...timeline.originalCommit!, sha: "def789abc123" } };
assert.deepEqual(listDecisionSourceLabels(focusedTimeline).slice(0, 2), ["[Sources: GitHub commit def789a]", "[Sources: GitHub commit abc123d]"]);
assert.equal(listDecisionSourceLabels({ ...timeline, focusCommit: timeline.originalCommit }).filter(label => label.includes("commit abc123d")).length, 1);
assert.ok(listDecisionSourcesChecklist(focusedTimeline).some(line => line.includes("commit def789a") && line.includes("provenance")));
