import * as vscode from "vscode";
import type { CodeHostProvider, CodeHostRepositoryConfig, CodeHostUserConfig } from "../api/codeHosts/types";

export function readCodeHostConfiguration(): CodeHostUserConfig {
  const config = vscode.workspace.getConfiguration("coopAI");
  const defaultCodeHost = readCodeHostProvider(config.get<string>("defaultCodeHost", "github"));
  const repositories = readRepositoryList(config.get<unknown>("repositories", []));
  const gitlabBaseUrl = config.get<string>("gitlab.baseUrl", "https://gitlab.com/api/v4").trim();
  return {
    defaultCodeHost,
    repositories,
    gitlabBaseUrl
  };
}

export function readRepositoryList(raw: unknown): CodeHostRepositoryConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && !!entry)
    .map((entry) => ({
      provider: entry.provider ? readCodeHostProvider(String(entry.provider)) : undefined,
      owner: String(entry.owner ?? "").trim(),
      repo: String(entry.repo ?? "").trim(),
      branch: entry.branch ? String(entry.branch).trim() : undefined
    }))
    .filter((entry) => entry.owner && entry.repo);
}

export function readCodeHostProvider(value: string): CodeHostProvider {
  if (value === "gitlab" || value === "bitbucket") {
    return value;
  }
  return "github";
}
