import * as vscode from "vscode";
import type { CodeHostProvider } from "./types";

export const SECRET_GITHUB_TOKEN = "coop.github.token";
export const SECRET_GITLAB_TOKEN = "coop.gitlab.token";
export const SECRET_BITBUCKET_USERNAME = "coop.bitbucket.username";
export const SECRET_BITBUCKET_APP_PASSWORD = "coop.bitbucket.appPassword";

export type CodeHostCredentials = {
  githubToken?: string;
  gitlabToken?: string;
  bitbucketUsername?: string;
  bitbucketAppPassword?: string;
};

export class CodeHostSecrets {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getCredentials(): Promise<CodeHostCredentials> {
    const [githubToken, gitlabToken, bitbucketUsername, bitbucketAppPassword] = await Promise.all([
      this.secrets.get(SECRET_GITHUB_TOKEN),
      this.secrets.get(SECRET_GITLAB_TOKEN),
      this.secrets.get(SECRET_BITBUCKET_USERNAME),
      this.secrets.get(SECRET_BITBUCKET_APP_PASSWORD)
    ]);
    return {
      githubToken: trimOrUndefined(githubToken),
      gitlabToken: trimOrUndefined(gitlabToken),
      bitbucketUsername: trimOrUndefined(bitbucketUsername),
      bitbucketAppPassword: trimOrUndefined(bitbucketAppPassword)
    };
  }

  public async setGitHubToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_GITHUB_TOKEN, token.trim());
  }

  public async clearGitHubToken(): Promise<void> {
    await this.secrets.delete(SECRET_GITHUB_TOKEN);
  }

  public async setGitLabToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_GITLAB_TOKEN, token.trim());
  }

  public async clearGitLabToken(): Promise<void> {
    await this.secrets.delete(SECRET_GITLAB_TOKEN);
  }

  public async setBitbucketCredentials(username: string, appPassword: string): Promise<void> {
    await this.secrets.store(SECRET_BITBUCKET_USERNAME, username.trim());
    await this.secrets.store(SECRET_BITBUCKET_APP_PASSWORD, appPassword.trim());
  }

  public async clearBitbucketCredentials(): Promise<void> {
    await Promise.all([
      this.secrets.delete(SECRET_BITBUCKET_USERNAME),
      this.secrets.delete(SECRET_BITBUCKET_APP_PASSWORD)
    ]);
  }

  public async hasProviderToken(provider: CodeHostProvider): Promise<boolean> {
    const creds = await this.getCredentials();
    switch (provider) {
      case "github":
        return Boolean(creds.githubToken);
      case "gitlab":
        return Boolean(creds.gitlabToken);
      case "bitbucket":
        return Boolean(creds.bitbucketUsername && creds.bitbucketAppPassword);
      default:
        return false;
    }
  }
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
