import * as vscode from "vscode";
import { isCoopDevMode } from "../config/lightningConfig";

export type SubscriptionPlan = "free" | "pro" | "enterprise";

export type LicenseStatus = {
  plan: SubscriptionPlan;
  isActive: boolean;
  seats?: number;
  expiresAt?: string;
  source: "config" | "api" | "default";
};

export const PRO_PLAN_PRICE_USD = 20;

const SECRET_KEY_LICENSE = "coopAI.licenseKey";

export function readConfiguredPlan(): SubscriptionPlan {
  if (!isCoopDevMode()) {
    return "free";
  }
  const value = vscode.workspace.getConfiguration("coopAI.license").get<string>("plan", "free");
  if (value === "pro" || value === "enterprise") {
    return value;
  }
  return "free";
}

export function isProOrHigher(plan: SubscriptionPlan): boolean {
  return plan === "pro" || plan === "enterprise";
}

export function canUseLightningMode(status: LicenseStatus): boolean {
  return status.isActive && isProOrHigher(status.plan);
}

export async function resolveLicenseStatus(
  secrets?: vscode.SecretStorage,
  apiBaseUrl?: string,
  clientFactory?: () => import("../api/CoopBackendClient").CoopBackendClient | undefined
): Promise<LicenseStatus> {
  if (secrets && apiBaseUrl) {
    const apiStatus = await resolveLicenseStatusFromApi(secrets, apiBaseUrl, clientFactory);
    if (apiStatus) {
      return apiStatus;
    }
  }

  const licenseKey = secrets ? await secrets.get(SECRET_KEY_LICENSE) : undefined;

  if (licenseKey?.trim()) {
    const parsed = parseLicenseKey(licenseKey.trim());
    if (parsed) {
      return {
        plan: parsed.plan,
        isActive: parsed.isActive,
        seats: parsed.seats,
        expiresAt: parsed.expiresAt,
        source: "api"
      };
    }
  }

  if (isCoopDevMode()) {
    const configuredPlan = readConfiguredPlan();
    if (configuredPlan !== "free") {
      return {
        plan: configuredPlan,
        isActive: true,
        source: "config"
      };
    }
  }

  return {
    plan: "free",
    isActive: true,
    source: "default"
  };
}

async function resolveLicenseStatusFromApi(
  secrets: vscode.SecretStorage,
  apiBaseUrl: string,
  clientFactory?: () => import("../api/CoopBackendClient").CoopBackendClient | undefined
): Promise<LicenseStatus | undefined> {
  const token = await secrets.get("coopAI.apiToken");
  if (!token?.trim()) {
    return undefined;
  }
  try {
    const { CoopBackendClient } = await import("../api/CoopBackendClient");
    const client = clientFactory?.() ?? new CoopBackendClient({ getToken: async () => token.trim() });
    const me = await client.fetchMe(apiBaseUrl);
    const plan = me.plan === "pro" || me.plan === "enterprise" ? me.plan : "free";
    return {
      plan,
      isActive: true,
      source: "api"
    };
  } catch {
    return undefined;
  }
}

export async function storeLicenseKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_KEY_LICENSE, key.trim());
}

export async function clearLicenseKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY_LICENSE);
}

export async function hasLicenseKey(secrets: vscode.SecretStorage): Promise<boolean> {
  const key = await secrets.get(SECRET_KEY_LICENSE);
  return Boolean(key?.trim());
}

type ParsedLicense = {
  plan: SubscriptionPlan;
  isActive: boolean;
  seats?: number;
  expiresAt?: string;
};

function parseLicenseKey(key: string): ParsedLicense | undefined {
  if (key.startsWith("pro:") || key.startsWith("coop-pro-") || key.startsWith("team:") || key.startsWith("coop-team-")) {
    return { plan: "pro", isActive: true, seats: parseSeats(key) };
  }
  if (key.startsWith("enterprise:") || key.startsWith("coop-ent-")) {
    return { plan: "enterprise", isActive: true, seats: parseSeats(key) };
  }
  return undefined;
}

function parseSeats(key: string): number | undefined {
  const match = key.match(/seats=(\d+)/i);
  if (!match) {
    return undefined;
  }
  const seats = Number(match[1]);
  return Number.isFinite(seats) ? seats : undefined;
}
