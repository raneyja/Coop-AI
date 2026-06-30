import type { CodeHostProviderPreference, RepoContext, UserPreferences } from "./types";

type RepoIdPreferences = Pick<UserPreferences, "owner" | "repo" | "defaultCodeHost">;
type RepoIdContext = Pick<RepoContext, "owner" | "repo" | "provider">;

export function buildRepoId(preferences: RepoIdPreferences, context: RepoIdContext = {}): string {
  const owner = context.owner ?? preferences.owner;
  const repo = context.repo ?? preferences.repo;
  const provider = (context.provider ?? preferences.defaultCodeHost) as CodeHostProviderPreference;
  if (owner && repo) {
    return `${provider}:${owner}/${repo}`;
  }
  return `${provider}:unknown/unknown`;
}
