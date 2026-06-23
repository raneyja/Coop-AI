import { personFormFromRecord, personRecordFromForm } from "./identityDirectory";
import type { IdentityDirectory, PersonIdentityForm, PersonRecord } from "./types";

/** Values extracted from OAuth connections and sign-in — used to populate the signed-in user. */
export type IdentityConnectionHints = {
  displayName?: string;
  githubLogin?: string;
  gitlabLogin?: string;
  slackUserId?: string;
  slackHandle?: string;
  workEmail?: string;
  jiraEmail?: string;
};

export function mergeSelfIdentityHints(
  directory: IdentityDirectory,
  hints: IdentityConnectionHints
): IdentityDirectory {
  if (!hasAnyHint(hints)) {
    return directory;
  }

  const people = [...directory.people];
  let selfIndex = people.findIndex((person) => person.isSelf);
  if (selfIndex < 0 && people.length === 1) {
    selfIndex = 0;
  }

  const existing =
    selfIndex >= 0
      ? people[selfIndex]
      : personRecordFromForm(emptySelfForm());

  const merged = mergeHintsIntoPerson(existing, hints);
  if (selfIndex >= 0) {
    people[selfIndex] = merged;
  } else {
    people.unshift(merged);
  }

  return { version: 1, people };
}

function mergeHintsIntoPerson(person: PersonRecord, hints: IdentityConnectionHints): PersonRecord {
  const form = personFormFromRecord(person);
  const merged = personRecordFromForm({
    ...form,
    isSelf: true,
    displayName: form.displayName || hints.displayName || "",
    githubLogin: form.githubLogin || hints.githubLogin || "",
    gitlabLogin: form.gitlabLogin || hints.gitlabLogin || "",
    slackUserId: form.slackUserId || hints.slackUserId || "",
    slackHandle: form.slackHandle || hints.slackHandle || "",
    workEmail: form.workEmail || hints.workEmail || "",
    jiraEmail: form.jiraEmail || hints.jiraEmail || ""
  });
  return { ...merged, isSelf: true };
}

function emptySelfForm(): PersonIdentityForm {
  return {
    id: `person-self-${Date.now().toString(36)}`,
    displayName: "",
    githubLogin: "",
    gitlabLogin: "",
    slackHandle: "",
    slackUserId: "",
    workEmail: "",
    personalEmail: "",
    jiraEmail: "",
    isSelf: true
  };
}

function hasAnyHint(hints: IdentityConnectionHints): boolean {
  return Boolean(
    hints.displayName ||
      hints.githubLogin ||
      hints.gitlabLogin ||
      hints.slackUserId ||
      hints.slackHandle ||
      hints.workEmail ||
      hints.jiraEmail
  );
}
