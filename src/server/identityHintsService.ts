import type { CodeHostProvider } from "../api/codeHosts/types";
import type { IdentityConnectionHints } from "../identity/identityAutoSeed";
import { getConnector } from "./codeHostConnectors/registry";
import { resolveCodeHostTokenForOrg } from "./codeHostCredentialResolver";
import type { IntegrationConnectionStore } from "./integrationConnectionStore";
import { loadGitLabAppConfig, gitlabApiBaseUrl } from "./gitlabAppConfig";
import type { AuthContext, OrgStore } from "./orgStore";
import type { UserStore } from "./users/userStore";

export type IdentityHintsDeps = {
  orgStore?: OrgStore;
  integrationStore?: IntegrationConnectionStore;
  userStore?: UserStore;
  allowPatFallback?: boolean;
};

export async function buildIdentityConnectionHints(
  auth: AuthContext,
  deps: IdentityHintsDeps
): Promise<IdentityConnectionHints> {
  const hints: IdentityConnectionHints = {};

  if (auth.userId && deps.userStore) {
    const user = await deps.userStore.getUser(auth.userId);
    if (user?.email) {
      hints.workEmail = user.email.trim();
      hints.displayName = hints.displayName ?? displayNameFromEmail(user.email);
    }
  }

  if (deps.integrationStore && auth.orgId !== "legacy") {
    const [slack, atlassian, googleDocs, teams] = await Promise.all([
      deps.integrationStore.get(auth.orgId, "slack"),
      deps.integrationStore.get(auth.orgId, "atlassian"),
      deps.integrationStore.get(auth.orgId, "google-docs"),
      deps.integrationStore.get(auth.orgId, "teams")
    ]);

    if (slack?.metadata.userId) {
      hints.slackUserId = slack.metadata.userId;
    }

    if (atlassian?.metadata.email) {
      hints.jiraEmail = atlassian.metadata.email;
      hints.workEmail = hints.workEmail ?? atlassian.metadata.email;
    }

    if (googleDocs?.metadata.email) {
      hints.workEmail = hints.workEmail ?? googleDocs.metadata.email;
    }
    if (googleDocs?.metadata.displayName) {
      hints.displayName = hints.displayName ?? googleDocs.metadata.displayName;
    }

    if (teams?.metadata.email) {
      hints.workEmail = hints.workEmail ?? teams.metadata.email;
    }
    if (teams?.metadata.displayName) {
      hints.displayName = hints.displayName ?? teams.metadata.displayName;
    }
  }

  if (deps.orgStore && auth.orgId !== "legacy") {
    const [githubLogin, gitlabLogin] = await Promise.all([
      fetchCodeHostLogin(deps, auth.orgId, "github"),
      fetchCodeHostLogin(deps, auth.orgId, "gitlab")
    ]);
    if (githubLogin) {
      hints.githubLogin = githubLogin;
    }
    if (gitlabLogin) {
      hints.gitlabLogin = gitlabLogin;
    }
  }

  return hints;
}

async function fetchCodeHostLogin(
  deps: IdentityHintsDeps,
  orgId: string,
  provider: CodeHostProvider
): Promise<string | undefined> {
  if (!deps.orgStore) {
    return undefined;
  }
  const token = await resolveCodeHostTokenForOrg(orgId, provider, {
    orgStore: deps.orgStore,
    connector: getConnector(provider),
    allowPatFallback: deps.allowPatFallback ?? false
  });
  if (!token) {
    return undefined;
  }
  if (provider === "github") {
    return fetchGithubLogin(token);
  }
  if (provider === "gitlab") {
    return fetchGitlabLogin(token);
  }
  return undefined;
}

async function fetchGithubLogin(token: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "coop-ai-backend"
      }
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { login?: string };
    return typeof body.login === "string" ? body.login : undefined;
  } catch {
    return undefined;
  }
}

async function fetchGitlabLogin(token: string): Promise<string | undefined> {
  try {
    const config = loadGitLabAppConfig();
    const baseUrl = config ? gitlabApiBaseUrl(config.gitlabBaseUrl) : "https://gitlab.com/api/v4";
    const response = await fetch(`${baseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "coop-ai-backend"
      }
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { username?: string };
    return typeof body.username === "string" ? body.username : undefined;
  } catch {
    return undefined;
  }
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  if (!local) {
    return email;
  }
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
