import type { IntegrationProvider } from "./integrations";

export type HandoffProvider = Extract<IntegrationProvider, "slack" | "atlassian" | "teams">;

export const HANDOFF_PROVIDERS: HandoffProvider[] = ["slack", "atlassian", "teams"];

function storageKey(provider: HandoffProvider): string {
  return `coop_${provider}_handoff_pending`;
}

export function markHandoffPending(provider: HandoffProvider): void {
  try {
    localStorage.setItem(storageKey(provider), String(Date.now()));
  } catch {
    // ignore
  }
}

export function clearHandoffPending(provider: HandoffProvider): void {
  try {
    localStorage.removeItem(storageKey(provider));
  } catch {
    // ignore
  }
}

export function isHandoffPending(provider: HandoffProvider): boolean {
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

type HandoffChecklistStep = {
  role: string;
  body: string;
};

type HandoffCopy = {
  vendorName: string;
  checklistTitle: string;
  checklistSteps: [HandoffChecklistStep, HandoffChecklistStep];
  connectHint: string;
  waitingLabel: string;
  handoffIntro: string;
  handoffSteps: string[];
};

export const HANDOFF_COPY: Record<HandoffProvider, HandoffCopy> = {
  slack: {
    vendorName: "Slack",
    checklistTitle: "Slack workspace install — two roles",
    checklistSteps: [
      {
        role: "Coop admin (you)",
        body: "connect Slack here and choose channels to index."
      },
      {
        role: "Slack workspace admin",
        body: "approves the Coop app for your company workspace. If that is not you, use Send link to Slack admin below."
      }
    ],
    connectHint:
      "On Slack, approve the Coop app for your company workspace. After install, return here — status updates automatically.",
    waitingLabel: "Waiting for Slack",
    handoffIntro: "Send this link to your Slack workspace admin",
    handoffSteps: [
      "They open the link while signed into Slack.",
      "Approve the Coop app for your company workspace.",
      "You return here — Slack shows Connected when done."
    ]
  },
  atlassian: {
    vendorName: "Atlassian",
    checklistTitle: "Atlassian site install — two roles",
    checklistSteps: [
      {
        role: "Coop admin (you)",
        body: "connect Atlassian here and choose Jira projects and Confluence spaces."
      },
      {
        role: "Atlassian site admin",
        body: "approves the Coop app for your company site. If that is not you, use Send link to Atlassian admin below."
      }
    ],
    connectHint:
      "On Atlassian, approve the Coop app for your company site. After install, return here — status updates automatically.",
    waitingLabel: "Waiting for Atlassian",
    handoffIntro: "Send this link to your Atlassian site admin",
    handoffSteps: [
      "They open the link while signed into Atlassian.",
      "Approve the Coop app for your company Jira/Confluence site.",
      "You return here — Atlassian shows Connected when done."
    ]
  },
  teams: {
    vendorName: "Microsoft Teams",
    checklistTitle: "Teams app install — two roles",
    checklistSteps: [
      {
        role: "Coop admin (you)",
        body: "connect Teams here after IT grants admin consent."
      },
      {
        role: "Microsoft 365 admin",
        body: "grants tenant-wide admin consent for the Coop app. If that is not you, use Send link to Teams admin below."
      }
    ],
    connectHint:
      "On Microsoft, grant admin consent for the Coop app in your tenant. After consent, return here — status updates automatically.",
    waitingLabel: "Waiting for Teams",
    handoffIntro: "Send this link to your Microsoft 365 admin",
    handoffSteps: [
      "They open the link while signed into a work/school Microsoft account.",
      "Grant admin consent for the Coop app in your company tenant.",
      "You return here — Teams shows Connected when done."
    ]
  }
};
