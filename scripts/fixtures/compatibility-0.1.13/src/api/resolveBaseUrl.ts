import * as vscode from "vscode";
import { isCoopDevMode } from "../config/lightningConfig";
import { DEFAULT_API_BASE } from "../chat/types";

let jobsBaseUrlWarningShown = false;

export type ResolvedBaseUrl = {
  baseUrl: string;
  usedLegacyJobsOverride: boolean;
};

/**
 * Canonical CoopAI service URL (chat, graph, jobs on one host).
 * `coopAI.jobsBaseUrl` is deprecated: if it differs from apiBaseUrl, warn once and still prefer apiBaseUrl.
 */
export function resolveCoopBaseUrl(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("coopAI")
): ResolvedBaseUrl {
  const configuredBaseUrl = (config.get<string>("apiBaseUrl", DEFAULT_API_BASE) || DEFAULT_API_BASE).replace(
    /\/$/,
    ""
  );
  const apiBaseUrl = isCoopDevMode() ? configuredBaseUrl : DEFAULT_API_BASE;
  const jobsBaseUrl = config.get<string>("jobsBaseUrl")?.replace(/\/$/, "");

  if (jobsBaseUrl && jobsBaseUrl !== apiBaseUrl && !jobsBaseUrlWarningShown) {
    jobsBaseUrlWarningShown = true;
    void vscode.window
      .showWarningMessage(
        "coopAI.jobsBaseUrl is deprecated. Use coopAI.apiBaseUrl for chat, graph, and jobs on one host.",
        "Open Settings"
      )
      .then((choice) => {
        if (choice === "Open Settings") {
          void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:coop-ai.coop-ai");
        }
      });
  }

  return { baseUrl: apiBaseUrl, usedLegacyJobsOverride: Boolean(jobsBaseUrl && jobsBaseUrl !== apiBaseUrl) };
}

export function assertCoopEndpoint(baseUrl: string): void {
  if (baseUrl.startsWith("https://")) {
    return;
  }
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl)) {
    return;
  }
  throw new Error("CoopAI API must use HTTPS, or http://localhost for local development.");
}
