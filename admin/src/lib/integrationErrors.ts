import type { IntegrationProvider } from "./integrations";
import { INTEGRATIONS } from "./integrations";

function providerLabel(provider: IntegrationProvider | string): string {
  return INTEGRATIONS.find((entry) => entry.id === provider)?.name ?? String(provider);
}

export function formatIntegrationError(
  provider: IntegrationProvider | string,
  status: number,
  raw?: string
): string {
  const name = providerLabel(provider);
  const message = raw?.trim() ?? "";

  if (status === 503 || /not configured on this server/i.test(message)) {
    return `${name} is not set up on this Coop server. Contact your Coop administrator.`;
  }
  if (status === 403) {
    if (/admin_required|org_admin_required|owners and admins/i.test(message)) {
      return "Only organization owners and admins can connect integrations.";
    }
    if (/code_host_plan_required|remote_code_plan_required|\bplan\b|upgrade/i.test(message)) {
      return `${name} is not available on your current plan. Upgrade your Coop plan to connect this integration.`;
    }
    if (message) {
      return message;
    }
    return `You do not have permission to connect ${name}.`;
  }
  if (/API token is invalid|unauthorized.*notion/i.test(message)) {
    return `${name} token is invalid. Copy the Internal integration secret from notion.so/my-integrations → Configuration into NOTION_INTEGRATION_TOKEN in .env.backend, then restart the API.`;
  }
  if (/invalid_client/i.test(message)) {
    if (/secret_/i.test(message)) {
      return `${name} OAuth is misconfigured: NOTION_APP_CLIENT_SECRET is an internal integration secret, not an OAuth client secret. Create a public OAuth integration at notion.so/my-integrations.`;
    }
    return `${name} OAuth failed — the client ID or secret on this Coop server does not match your Notion OAuth integration. In .env.backend, set NOTION_APP_CLIENT_ID and NOTION_APP_CLIENT_SECRET from a public OAuth integration (not an internal integration secret).`;
  }
  if (/redirect_uri/i.test(message)) {
    return `OAuth redirect failed. Your administrator must register the Coop callback URL in the ${name} app settings.`;
  }
  if (/Invalid permissions requested/i.test(message)) {
    return `Slack rejected the requested permissions. Your Coop administrator must add the required scopes in the Slack app settings, reinstall the app, then reconnect here.`;
  }
  if (/missing_scope/i.test(message)) {
    return "Channel list unavailable. Disconnect and reconnect Slack so Coop can refresh its bot token with channels:read and groups:read scopes.";
  }
  if (/bot token unavailable/i.test(message)) {
    return "Slack bot token missing. Disconnect and reconnect Slack, then open Manage access again.";
  }
  if (/insufficient.*scope/i.test(message) || /insufficientPermissions/i.test(message)) {
    return "Google Drive access is incomplete. Revoke Coop at myaccount.google.com/permissions, then connect again.";
  }
  if (status === 0) {
    return "Could not reach the Coop API. Check your network and API base URL.";
  }
  if (message) {
    return message;
  }
  return `Request failed (${status}). Try refresh, then disconnect and connect.`;
}
