export type IdentityProvider = "github" | "gitlab" | "slack" | "jira" | "email";

export type IdentityLinkSource = "explicit" | "inferred" | "none";

export type IdentityLinkRecord = {
  provider: IdentityProvider;
  /** GitHub login, Slack handle/user id, or email address. */
  externalId: string;
  /** Disambiguates email links: work | personal */
  label?: string;
};

export type PersonRecord = {
  id: string;
  displayName: string;
  links: IdentityLinkRecord[];
  /** Marks the signed-in engineer's own profile. */
  isSelf?: boolean;
};

export type IdentityDirectory = {
  version: 1;
  people: PersonRecord[];
};

export type PersonIdentityForm = {
  id: string;
  displayName: string;
  githubLogin: string;
  gitlabLogin: string;
  slackHandle: string;
  slackUserId: string;
  workEmail: string;
  personalEmail: string;
  jiraEmail: string;
  isSelf?: boolean;
};

export const EMPTY_IDENTITY_DIRECTORY: IdentityDirectory = {
  version: 1,
  people: []
};
