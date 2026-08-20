import type { CodeHostProviderPreference } from "../chat/types";
import {
  createConfirmSubmitGuard,
  evaluateCreatePullRequest as evaluateCreatePullRequestCore,
  isPullRequestWriteSupported,
  normalizeWriteFiles
} from "../api/codeHosts/pullRequestWrite";

export const CREATE_PULL_REQUEST_BUTTON_LABEL = "Create pull request";
export const CREATE_PULL_REQUEST_BUTTON_CLASS = "coop-text-btn";
export const CREATE_PR_NOT_YET_LABEL = "Not yet";
export const PR_NOTES_AI_GENERATED_LABEL = "(AI Generated)";
export const CREATE_PR_SUCCESS_TITLE = "Pull request created";
export const CREATE_PR_DONE_LABEL = "Done";

export const CREATE_PR_MODAL_CLASSES = {
  backdrop: "coop-prompt-modal-backdrop",
  dialog: "coop-prompt-modal",
  titleId: "coop-create-pr-modal-title"
} as const;

export type CreatePullRequestFile = {
  path: string;
  content: string;
};

export type CreatePullRequestDraft = {
  provider?: CodeHostProviderPreference;
  branch: string;
  title: string;
  body?: string;
  base?: string;
  files: CreatePullRequestFile[];
};

export type CreatePullRequestCreated = {
  htmlUrl: string;
  number: number;
  provider?: CodeHostProviderPreference;
};

export function pullRequestHostLabel(provider?: CodeHostProviderPreference): string {
  if (provider === "gitlab") {
    return "GitLab";
  }
  if (provider === "bitbucket") {
    return "Bitbucket";
  }
  return "GitHub";
}

export function pullRequestCreatedCopy(provider?: CodeHostProviderPreference): string {
  return `Opened on ${pullRequestHostLabel(provider)}.`;
}

export function openPullRequestOnHostLabel(provider?: CodeHostProviderPreference): string {
  return `Open on ${pullRequestHostLabel(provider)}`;
}

export function createdPullRequestFromResult(
  result:
    | CreatePullRequestCreated
    | { error: string }
    | undefined
): CreatePullRequestCreated | undefined {
  if (result && "htmlUrl" in result && result.htmlUrl) {
    return result;
  }
  return undefined;
}

export function prCreateErrorFromResult(
  result: CreatePullRequestCreated | { error: string } | undefined
): string | undefined {
  if (result && "error" in result) {
    return result.error;
  }
  return undefined;
}

export type { CreatePullRequestDecision, CreatePullRequestEvaluation } from "../api/codeHosts/pullRequestWrite";
export { createConfirmSubmitGuard, isPullRequestWriteSupported };

export function filesWithContent(files: Array<{ path: string; content?: string }> | undefined): CreatePullRequestFile[] {
  return normalizeWriteFiles(
    (files ?? []).flatMap((file) =>
      typeof file.path === "string" && typeof file.content === "string" ? [{ path: file.path, content: file.content }] : []
    )
  );
}

export function evaluateCreatePullRequest(
  draft: CreatePullRequestDraft,
  decision: import("../api/codeHosts/pullRequestWrite").CreatePullRequestDecision
): import("../api/codeHosts/pullRequestWrite").CreatePullRequestEvaluation {
  return evaluateCreatePullRequestCore(draft, decision);
}

export function defaultPrBranchName(): string {
  return "coop/patch";
}

export function defaultPrTitle(filePaths: string[]): string {
  if (filePaths.length === 1) {
    return `Update ${filePaths[0]}`;
  }
  if (filePaths.length > 1) {
    return `Update ${filePaths.length} files`;
  }
  return "Coop patch";
}
