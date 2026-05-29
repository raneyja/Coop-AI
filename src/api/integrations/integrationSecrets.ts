import * as vscode from "vscode";

export const SECRET_SLACK_TOKEN = "coop.slack.token";
export const SECRET_JIRA_TOKEN = "coop.jira.token";
export const SECRET_JIRA_EMAIL = "coop.jira.email";
export const SECRET_JIRA_BASE_URL = "coop.jira.baseUrl";
export const SECRET_TEAMS_TOKEN = "coop.teams.token";

export type IntegrationCredentials = {
  slackToken?: string;
  jiraToken?: string;
  jiraEmail?: string;
  jiraBaseUrl?: string;
  teamsToken?: string;
};

export class IntegrationSecrets {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getCredentials(): Promise<IntegrationCredentials> {
    const [slackToken, jiraToken, jiraEmail, jiraBaseUrl, teamsToken] = await Promise.all([
      this.secrets.get(SECRET_SLACK_TOKEN),
      this.secrets.get(SECRET_JIRA_TOKEN),
      this.secrets.get(SECRET_JIRA_EMAIL),
      this.secrets.get(SECRET_JIRA_BASE_URL),
      this.secrets.get(SECRET_TEAMS_TOKEN)
    ]);
    return {
      slackToken: trimOrUndefined(slackToken),
      jiraToken: trimOrUndefined(jiraToken),
      jiraEmail: trimOrUndefined(jiraEmail),
      jiraBaseUrl: trimOrUndefined(jiraBaseUrl) ?? "https://your-domain.atlassian.net",
      teamsToken: trimOrUndefined(teamsToken)
    };
  }

  public async setSlackToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_SLACK_TOKEN, token.trim());
  }

  public async clearSlackToken(): Promise<void> {
    await this.secrets.delete(SECRET_SLACK_TOKEN);
  }

  public async setJiraCredentials(email: string, token: string, baseUrl?: string): Promise<void> {
    await this.secrets.store(SECRET_JIRA_EMAIL, email.trim());
    await this.secrets.store(SECRET_JIRA_TOKEN, token.trim());
    if (baseUrl?.trim()) {
      await this.updateJiraBaseUrl(baseUrl);
    }
  }

  public async updateJiraBaseUrl(baseUrl: string): Promise<void> {
    await this.secrets.store(SECRET_JIRA_BASE_URL, baseUrl.trim().replace(/\/+$/, ""));
  }

  public async clearJiraCredentials(): Promise<void> {
    await Promise.all([
      this.secrets.delete(SECRET_JIRA_EMAIL),
      this.secrets.delete(SECRET_JIRA_TOKEN),
      this.secrets.delete(SECRET_JIRA_BASE_URL)
    ]);
  }

  public async setTeamsToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_TEAMS_TOKEN, token.trim());
  }

  public async clearTeamsToken(): Promise<void> {
    await this.secrets.delete(SECRET_TEAMS_TOKEN);
  }
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
