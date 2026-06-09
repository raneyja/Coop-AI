import type {
  IdentityDirectory,
  IdentityLinkRecord,
  IdentityProvider,
  PersonIdentityForm,
  PersonRecord
} from "./types";
import { EMPTY_IDENTITY_DIRECTORY } from "./types";

export function normalizeIdentityDirectory(raw: unknown): IdentityDirectory {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_IDENTITY_DIRECTORY };
  }
  const record = raw as Partial<IdentityDirectory>;
  if (record.version !== 1 || !Array.isArray(record.people)) {
    return { ...EMPTY_IDENTITY_DIRECTORY };
  }
  const people = record.people
    .filter((person): person is PersonRecord => Boolean(person && typeof person === "object"))
    .map((person) => ({
      id: String(person.id || cryptoRandomId()),
      displayName: String(person.displayName || "").trim(),
      isSelf: Boolean(person.isSelf),
      links: Array.isArray(person.links)
        ? person.links
            .filter((link): link is IdentityLinkRecord => Boolean(link && typeof link === "object"))
            .map((link) => ({
              provider: link.provider,
              externalId: String(link.externalId || "").trim(),
              label: link.label?.trim() || undefined
            }))
            .filter((link) => link.externalId.length > 0)
        : []
    }))
    .filter((person) => person.displayName.length > 0);
  return { version: 1, people };
}

export function personFormFromRecord(person: PersonRecord): PersonIdentityForm {
  const link = (provider: IdentityProvider, label?: string) =>
    person.links.find(
      (entry) => entry.provider === provider && (label ? entry.label === label : !entry.label)
    )?.externalId ?? "";

  const slackLinks = person.links.filter((entry) => entry.provider === "slack");
  const slackUserId =
    slackLinks.find((entry) => /^[UW][A-Z0-9]+$/i.test(entry.externalId))?.externalId ?? "";
  const slackHandle =
    slackLinks.find((entry) => !/^[UW][A-Z0-9]+$/i.test(entry.externalId))?.externalId ?? "";

  return {
    id: person.id,
    displayName: person.displayName,
    githubLogin: link("github"),
    gitlabLogin: link("gitlab"),
    slackHandle: slackHandle.replace(/^@/, ""),
    slackUserId,
    workEmail: link("email", "work"),
    personalEmail: link("email", "personal"),
    jiraEmail: link("jira"),
    isSelf: person.isSelf
  };
}

export function personRecordFromForm(form: PersonIdentityForm): PersonRecord {
  const links: IdentityLinkRecord[] = [];
  const add = (provider: IdentityProvider, externalId: string, label?: string) => {
    const trimmed = externalId.trim().replace(/^@/, "");
    if (!trimmed) {
      return;
    }
    links.push({ provider, externalId: trimmed, label });
  };

  add("github", form.githubLogin);
  add("gitlab", form.gitlabLogin);
  add("slack", form.slackUserId);
  add("slack", form.slackHandle);
  add("email", form.workEmail, "work");
  add("email", form.personalEmail, "personal");
  add("jira", form.jiraEmail);

  return {
    id: form.id || cryptoRandomId(),
    displayName: form.displayName.trim(),
    links,
    isSelf: form.isSelf
  };
}

export function findPersonInDirectory(
  directory: IdentityDirectory | undefined,
  identity: { githubLogin?: string; displayName?: string; email?: string }
): PersonRecord | undefined {
  if (!directory?.people.length) {
    return undefined;
  }

  const login = identity.githubLogin?.trim().toLowerCase();
  const displayName = identity.displayName?.trim().toLowerCase();
  const email = identity.email?.trim().toLowerCase();

  for (const person of directory.people) {
    for (const link of person.links) {
      const external = link.externalId.trim().toLowerCase();
      if (login && link.provider === "github" && external === login) {
        return person;
      }
      if (login && link.provider === "gitlab" && external === login) {
        return person;
      }
      if (email && link.provider === "email" && external === email) {
        return person;
      }
      if (email && link.provider === "jira" && external === email) {
        return person;
      }
    }
    if (displayName && person.displayName.trim().toLowerCase() === displayName) {
      return person;
    }
  }

  return undefined;
}

export type SlackLinkTarget = {
  userId?: string;
  handle?: string;
  emails: string[];
};

export function slackTargetForPerson(person: PersonRecord): SlackLinkTarget {
  const emails = person.links
    .filter((link) => link.provider === "email" || link.provider === "jira")
    .map((link) => link.externalId.trim())
    .filter(Boolean);

  let userId: string | undefined;
  let handle: string | undefined;

  for (const link of person.links) {
    if (link.provider !== "slack") {
      continue;
    }
    const external = link.externalId.trim().replace(/^@/, "");
    if (/^[UW][A-Z0-9]+$/i.test(external)) {
      userId = external;
    } else if (!handle) {
      handle = external;
    }
  }

  return { userId, handle, emails };
}

export function identityDirectorySummary(directory: IdentityDirectory): string {
  const count = directory.people.length;
  if (count === 0) {
    return "No linked identities";
  }
  if (count === 1) {
    return "1 person linked";
  }
  return `${count} people linked`;
}

function cryptoRandomId(): string {
  return `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
