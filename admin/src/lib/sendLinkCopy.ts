import type { IntegrationProvider } from "./integrations";

export type SendLinkProvider = Extract<
  IntegrationProvider,
  "github" | "slack" | "atlassian" | "teams"
>;

export const SEND_LINK_PROVIDERS: SendLinkProvider[] = ["github", "slack", "atlassian", "teams"];

export function supportsSendLink(provider: IntegrationProvider): provider is SendLinkProvider {
  return SEND_LINK_PROVIDERS.includes(provider as SendLinkProvider);
}

type SendLinkCopy = {
  vendorName: string;
  modalTitle: string;
  intro: string;
  steps: string[];
  waitingLabel: string;
};

export const SEND_LINK_COPY: Record<SendLinkProvider, SendLinkCopy> = {
  github: {
    vendorName: "GitHub",
    modalTitle: "Request access",
    intro: "Send this link to your GitHub admin to authorize access:",
    steps: [
      "Admin opens the auth link while signed into GitHub.",
      "Choose your organization — not a personal account.",
      "Select repositories to index, then click Install — or click Save if already installed.",
      "You return here — GitHub shows Connected when done."
    ],
    waitingLabel: "Waiting for GitHub"
  },
  slack: {
    vendorName: "Slack",
    modalTitle: "Request access",
    intro: "Send this link to your Slack workspace admin:",
    steps: [
      "Admin opens the auth link while signed into Slack.",
      "Approve the Coop app for your company workspace.",
      "You return here — Slack shows Connected when done."
    ],
    waitingLabel: "Waiting for Slack"
  },
  teams: {
    vendorName: "Microsoft Teams",
    modalTitle: "Request access",
    intro: "Send this link to your Microsoft Teams workspace admin:",
    steps: [
      "Admin opens the auth link while signed into Microsoft Teams.",
      "Approve the Coop app for your company workspace.",
      "You return here — Microsoft Teams shows Connected when done."
    ],
    waitingLabel: "Waiting for Teams"
  },
  atlassian: {
    vendorName: "Atlassian",
    modalTitle: "Request access",
    intro: "Send this link to your Atlassian site admin:",
    steps: [
      "Admin opens the auth link while signed into Atlassian.",
      "Approve the Coop app for your company Jira/Confluence site.",
      "You return here — Atlassian shows Connected when done."
    ],
    waitingLabel: "Waiting for Atlassian"
  }
};

function storageKey(provider: SendLinkProvider): string {
  return `coop_${provider}_handoff_pending`;
}

export function markSendLinkPending(provider: SendLinkProvider): void {
  try {
    localStorage.setItem(storageKey(provider), String(Date.now()));
  } catch {
    // ignore
  }
}

export function clearSendLinkPending(provider: SendLinkProvider): void {
  try {
    localStorage.removeItem(storageKey(provider));
  } catch {
    // ignore
  }
}

export function isSendLinkPending(provider: SendLinkProvider): boolean {
  try {
    const raw = localStorage.getItem(storageKey(provider));
    if (!raw) {
      return false;
    }
    const ageMs = Date.now() - Number(raw);
    if (!Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(storageKey(provider));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
