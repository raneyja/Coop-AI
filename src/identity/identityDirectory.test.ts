import assert from "node:assert/strict";
import {
  findPersonInDirectory,
  normalizeIdentityDirectory,
  personFormFromRecord,
  personRecordFromForm,
  slackTargetForPerson
} from "./identityDirectory";
import type { IdentityDirectory, PersonIdentityForm } from "./types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const jonDirectory: IdentityDirectory = {
  version: 1,
  people: [
    {
      id: "person-jon",
      displayName: "Jon Raney",
      isSelf: true,
      links: [
        { provider: "github", externalId: "raneyja" },
        { provider: "slack", externalId: "jon" },
        { provider: "email", externalId: "jon@coop-ai.dev", label: "work" },
        { provider: "email", externalId: "jonathanaraney@gmail.com", label: "personal" }
      ]
    }
  ]
};

test("normalizeIdentityDirectory returns empty directory for invalid input", () => {
  assert.deepEqual(normalizeIdentityDirectory(undefined), { version: 1, people: [] });
  assert.deepEqual(normalizeIdentityDirectory({ version: 2, people: [] }), { version: 1, people: [] });
});

test("normalizeIdentityDirectory drops people without display names", () => {
  const normalized = normalizeIdentityDirectory({
    version: 1,
    people: [{ id: "x", displayName: "  ", links: [] }]
  });
  assert.equal(normalized.people.length, 0);
});

test("personFormFromRecord maps links to form fields", () => {
  const form = personFormFromRecord(jonDirectory.people[0]);
  assert.equal(form.githubLogin, "raneyja");
  assert.equal(form.slackHandle, "jon");
  assert.equal(form.workEmail, "jon@coop-ai.dev");
  assert.equal(form.personalEmail, "jonathanaraney@gmail.com");
});

test("personRecordFromForm roundtrips links", () => {
  const form = personFormFromRecord(jonDirectory.people[0]);
  const restored = personRecordFromForm(form);
  assert.equal(restored.displayName, "Jon Raney");
  assert.ok(
    restored.links.some(
      (link) => link.provider === "github" && link.externalId === "raneyja"
    )
  );
  assert.ok(
    restored.links.some(
      (link) => link.provider === "slack" && link.externalId === "jon"
    )
  );
});

test("personRecordFromForm strips leading @ from slack handle", () => {
  const form: PersonIdentityForm = {
    id: "p1",
    displayName: "Alex",
    githubLogin: "",
    gitlabLogin: "",
    slackHandle: "@alex",
    slackUserId: "",
    workEmail: "",
    personalEmail: "",
    jiraEmail: ""
  };
  const record = personRecordFromForm(form);
  assert.ok(record.links.some((link) => link.provider === "slack" && link.externalId === "alex"));
});

test("findPersonInDirectory resolves by github login", () => {
  const person = findPersonInDirectory(jonDirectory, { githubLogin: "raneyja" });
  assert.equal(person?.displayName, "Jon Raney");
});

test("findPersonInDirectory resolves by work email", () => {
  const person = findPersonInDirectory(jonDirectory, { email: "jon@coop-ai.dev" });
  assert.equal(person?.displayName, "Jon Raney");
});

test("findPersonInDirectory returns undefined when no match", () => {
  assert.equal(findPersonInDirectory(jonDirectory, { githubLogin: "unknown" }), undefined);
  assert.equal(findPersonInDirectory({ version: 1, people: [] }, { githubLogin: "raneyja" }), undefined);
});

test("slackTargetForPerson extracts handle and emails", () => {
  const target = slackTargetForPerson(jonDirectory.people[0]);
  assert.equal(target.handle, "jon");
  assert.ok(target.emails.includes("jon@coop-ai.dev"));
  assert.ok(target.emails.includes("jonathanaraney@gmail.com"));
});

test("slackTargetForPerson prefers slack user id when present", () => {
  const person = personRecordFromForm({
    id: "p2",
    displayName: "Sam",
    githubLogin: "",
    gitlabLogin: "",
    slackHandle: "sam",
    slackUserId: "U012ABCDEF",
    workEmail: "",
    personalEmail: "",
    jiraEmail: ""
  });
  const target = slackTargetForPerson(person);
  assert.equal(target.userId, "U012ABCDEF");
  assert.equal(target.handle, "sam");
});

console.log(`\nidentityDirectory: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
