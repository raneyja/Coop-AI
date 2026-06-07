const PLACEHOLDER_HOSTS = new Set(["your-domain.atlassian.net", "your-company.atlassian.net"]);

export function isPlaceholderAtlassianSite(url: string | undefined): boolean {
  if (!url?.trim()) {
    return false;
  }
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return PLACEHOLDER_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function normalizeConfluenceWikiBase(url: string): string {
  const base = url.trim().replace(/\/+$/, "");
  return base.endsWith("/wiki") ? base : `${base}/wiki`;
}

/** Prefer a configured Confluence URL; fall back to Jira site + /wiki when still on the placeholder. */
export function resolveConfluenceBaseUrl(options: {
  confluenceBaseUrl?: string;
  jiraBaseUrl?: string;
}): { baseUrl: string; derivedFromJira: boolean } {
  const confluence = options.confluenceBaseUrl?.trim();
  if (confluence && !isPlaceholderAtlassianSite(confluence)) {
    return { baseUrl: normalizeConfluenceWikiBase(confluence), derivedFromJira: false };
  }

  const jira = options.jiraBaseUrl?.trim();
  if (jira && !isPlaceholderAtlassianSite(jira)) {
    return { baseUrl: normalizeConfluenceWikiBase(jira), derivedFromJira: true };
  }

  return {
    baseUrl: confluence ? normalizeConfluenceWikiBase(confluence) : "https://your-domain.atlassian.net/wiki",
    derivedFromJira: false
  };
}

export function confluenceSiteUrlError(baseUrl: string): string | undefined {
  if (!isPlaceholderAtlassianSite(baseUrl)) {
    return undefined;
  }
  return (
    "Confluence site URL is still the default placeholder (your-domain.atlassian.net). " +
    "Change it to your real Atlassian site with /wiki appended — e.g. https://coop-ai.atlassian.net/wiki."
  );
}

export type ConfluenceAuth = {
  email: string;
  apiToken: string;
  /** Where the email/token came from — useful for error messages. */
  credentialSource: "confluence" | "jira";
};

export function resolveConfluenceAuth(
  creds: {
    confluenceEmail?: string;
    confluenceToken?: string;
    jiraEmail?: string;
    jiraToken?: string;
  },
  draft?: { email?: string; token?: string }
): ConfluenceAuth | undefined {
  const email = draft?.email?.trim() || creds.confluenceEmail || creds.jiraEmail;
  const token = draft?.token?.trim() || creds.confluenceToken || creds.jiraToken;
  if (!email || !token) {
    return undefined;
  }

  const credentialSource: ConfluenceAuth["credentialSource"] =
    token === creds.jiraToken && token !== creds.confluenceToken ? "jira" : "confluence";

  return { email, apiToken: token, credentialSource };
}

export function confluenceSiteHostname(baseUrl: string): string {
  try {
    return new URL(normalizeConfluenceWikiBase(baseUrl)).hostname;
  } catch {
    return baseUrl;
  }
}
