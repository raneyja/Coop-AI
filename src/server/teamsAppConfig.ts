import { resolvePublicBaseUrl } from "./publicBaseUrl";

export type TeamsAppConfig = {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
};

const AZURE_CLIENT_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Azure client secret Values contain `~`; Application (client) IDs are UUIDs. */
export function looksLikeAzureClientSecret(value: string): boolean {
  return value.includes("~");
}

export function looksLikeAzureClientId(value: string): boolean {
  return AZURE_CLIENT_ID_PATTERN.test(value);
}

export function describeTeamsAppConfigProblem(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const clientId = env.TEAMS_APP_CLIENT_ID?.trim();
  const clientSecret = env.TEAMS_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }
  if (looksLikeAzureClientSecret(clientId) || !looksLikeAzureClientId(clientId)) {
    return (
      "TEAMS_APP_CLIENT_ID must be the Application (client) ID (UUID) from Azure Entra → App registrations → Overview — not the client secret Value from Certificates & secrets."
    );
  }
  if (looksLikeAzureClientId(clientSecret)) {
    return (
      "TEAMS_APP_CLIENT_SECRET looks like an Application (client) ID. Use the secret Value from Azure Entra → Certificates & secrets instead."
    );
  }
  return undefined;
}

/**
 * Microsoft Entra / Graph OAuth for Teams message search.
 *
 * Required:
 *   TEAMS_APP_CLIENT_ID — Application (client) ID (UUID)
 *   TEAMS_APP_CLIENT_SECRET — client secret Value (often contains ~)
 */
export function loadTeamsAppConfig(env: NodeJS.ProcessEnv = process.env): TeamsAppConfig | undefined {
  const clientId = env.TEAMS_APP_CLIENT_ID?.trim();
  const clientSecret = env.TEAMS_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }
  if (describeTeamsAppConfigProblem(env)) {
    return undefined;
  }
  return {
    clientId,
    clientSecret,
    publicBaseUrl: resolvePublicBaseUrl(env)
  };
}
