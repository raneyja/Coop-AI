import assert from "node:assert/strict";
import { mergeSelfIdentityHints } from "./identityAutoSeed";
import type { IdentityDirectory } from "./types";

const empty: IdentityDirectory = { version: 1, people: [] };

const seeded = mergeSelfIdentityHints(empty, {
  displayName: "Jon Raney",
  githubLogin: "raneyja",
  slackUserId: "U012ABCDEF",
  workEmail: "jon@coop-ai.dev"
});

assert.equal(seeded.people.length, 1);
assert.equal(seeded.people[0]?.isSelf, true);
assert.equal(seeded.people[0]?.displayName, "Jon Raney");
assert.ok(
  seeded.people[0]?.links.some(
    (link) => link.provider === "github" && link.externalId === "raneyja"
  )
);
assert.ok(
  seeded.people[0]?.links.some(
    (link) => link.provider === "slack" && link.externalId === "U012ABCDEF"
  )
);

const existing: IdentityDirectory = {
  version: 1,
  people: [
    {
      id: "self",
      displayName: "Jon Raney",
      isSelf: true,
      links: [{ provider: "github", externalId: "raneyja" }]
    }
  ]
};

const merged = mergeSelfIdentityHints(existing, {
  slackUserId: "U999",
  githubLogin: "other-login"
});
assert.ok(
  merged.people[0]?.links.some(
    (link) => link.provider === "github" && link.externalId === "raneyja"
  ),
  "manual github login is preserved"
);
assert.ok(
  merged.people[0]?.links.some(
    (link) => link.provider === "slack" && link.externalId === "U999"
  ),
  "missing slack id is filled from hints"
);

console.log("identityAutoSeed: ok");
