import type { GitHubAppConfig } from "./githubAppConfig";
import type { GitHubAppService } from "./githubAppService";
import type { GitHubOAuthConfig } from "./githubOAuthConfig";
import type { GitHubOAuthService } from "./githubOAuthService";

export type GithubInstallUrlMode = "app" | "oauth" | "auto";

export type GithubConnectCapabilities = {
  githubAppAvailable: boolean;
  oauthAvailable: boolean;
};

export type GithubInstallUrlResult = {
  url: string;
  kind: "github_app" | "oauth";
} & GithubConnectCapabilities;

export type GithubInstallUrlDeps = {
  githubApp?: GitHubAppService;
  githubAppConfig?: GitHubAppConfig;
  githubOAuth?: GitHubOAuthService;
  githubOAuthConfig?: GitHubOAuthConfig;
};

export function githubConnectCapabilities(deps: GithubInstallUrlDeps): GithubConnectCapabilities {
  return {
    githubAppAvailable: Boolean(deps.githubApp && deps.githubAppConfig),
    oauthAvailable: Boolean(deps.githubOAuth && deps.githubOAuthConfig)
  };
}

export function buildGithubOAuthRedirectUri(config: GitHubOAuthConfig): string {
  return `${config.publicBaseUrl.replace(/\/$/, "")}/v1/github/app/callback`;
}

export function resolveGithubInstallUrl(
  deps: GithubInstallUrlDeps,
  orgId: string,
  mode: GithubInstallUrlMode = "auto"
): GithubInstallUrlResult | undefined {
  const capabilities = githubConnectCapabilities(deps);

  if (mode === "oauth") {
    if (!capabilities.oauthAvailable || !deps.githubOAuth || !deps.githubOAuthConfig) {
      return undefined;
    }
    return {
      ...capabilities,
      kind: "oauth",
      url: deps.githubOAuth.buildAuthorizeUrl(
        buildGithubOAuthRedirectUri(deps.githubOAuthConfig),
        orgId
      )
    };
  }

  if (capabilities.githubAppAvailable && deps.githubApp && deps.githubAppConfig) {
    return {
      ...capabilities,
      kind: "github_app",
      url: deps.githubApp.buildInstallUrl(deps.githubAppConfig.slug, orgId)
    };
  }

  if (mode === "app") {
    return undefined;
  }

  if (capabilities.oauthAvailable && deps.githubOAuth && deps.githubOAuthConfig) {
    return {
      ...capabilities,
      kind: "oauth",
      url: deps.githubOAuth.buildAuthorizeUrl(
        buildGithubOAuthRedirectUri(deps.githubOAuthConfig),
        orgId
      )
    };
  }

  return undefined;
}
