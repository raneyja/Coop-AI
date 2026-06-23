import type { QuickActionId } from "./types";

export type EvidenceActionKind =
  | "open-url"
  | "open-file"
  | "search"
  | "composer-followup"
  | "quick-action"
  | "open-lightning";

export type EvidenceActionSearchType =
  | "pr"
  | "ownership"
  | "impact"
  | "docs"
  | "jira"
  | "integration"
  | "generic";

export type EvidenceRecommendedAction = {
  label: string;
  kind: EvidenceActionKind;
  url?: string;
  path?: string;
  line?: number;
  searchType?: EvidenceActionSearchType;
  composerPrompt?: string;
  /** Runs a quick action (same path as grid buttons and slash commands). */
  quickActionId?: QuickActionId;
};

export type EvidenceActionContext = {
  onOpenFile?: (path: string, line?: number, options?: { preserveContext?: boolean }) => void;
  onOpenLink?: (url: string) => void;
  onComposerFollowup?: (text: string) => void;
  onQuickAction?: (actionId: QuickActionId, targetPath?: string) => void;
  onOpenLightning?: () => void;
  onCopyText?: (text: string, toast?: string) => void;
  repoContext?: {
    owner?: string;
    repo?: string;
    branch?: string;
    file?: string;
  };
};

export function executeEvidenceAction(
  action: EvidenceRecommendedAction,
  ctx: EvidenceActionContext
): void {
  switch (action.kind) {
    case "open-url": {
      const url = clean(action.url);
      if (!url) {
        return;
      }
      ctx.onOpenLink?.(url);
      return;
    }
    case "open-file": {
      const path = clean(action.path);
      if (!path) {
        return;
      }
      ctx.onOpenFile?.(path, action.line, { preserveContext: true });
      return;
    }
    case "search": {
      const followup = buildSearchFollowup(action, ctx);
      if (!followup) {
        return;
      }
      if (ctx.onComposerFollowup) {
        ctx.onComposerFollowup(followup);
      } else {
        ctx.onCopyText?.(followup, "Search prompt copied");
      }
      return;
    }
    case "composer-followup": {
      const prompt = clean(action.composerPrompt);
      if (!prompt) {
        return;
      }
      if (ctx.onComposerFollowup) {
        ctx.onComposerFollowup(prompt);
      } else {
        ctx.onCopyText?.(prompt, "Follow-up copied");
      }
      return;
    }
    case "quick-action": {
      const actionId = action.quickActionId;
      if (!actionId) {
        return;
      }
      ctx.onQuickAction?.(actionId, clean(action.path));
      return;
    }
    case "open-lightning": {
      ctx.onOpenLightning?.();
      return;
    }
  }
}

export function buildSearchFollowup(
  action: EvidenceRecommendedAction,
  ctx: EvidenceActionContext
): string {
  const customPrompt = clean(action.composerPrompt);
  if (customPrompt) {
    return customPrompt;
  }

  const scope = clean(action.path) ?? clean(ctx.repoContext?.file) ?? "this area";
  const repo = repoLabel(ctx.repoContext?.owner, ctx.repoContext?.repo);
  const repoPhrase = repo ? ` in ${repo}` : "";
  const branchPhrase = clean(ctx.repoContext?.branch) ? ` on ${ctx.repoContext?.branch}` : "";

  switch (action.searchType ?? "generic") {
    case "pr":
      return `Find pull requests related to ${scope}${repoPhrase}${branchPhrase}. Focus on rationale, reviewers, and linked issues.`;
    case "ownership":
      return `Search for additional ownership signals for ${scope}${repoPhrase}${branchPhrase}. Include commit history, CODEOWNERS, and recent review activity.`;
    case "impact":
      return `Investigate transitive impact for ${scope}${repoPhrase}${branchPhrase}. Identify downstream files, services, and active change surfaces.`;
    case "docs":
      return `Search for docs and runbooks relevant to ${scope}${repoPhrase}${branchPhrase}. Prioritize architecture notes and operational guidance.`;
    case "jira":
      return `Search Jira for tickets related to ${scope}${repoPhrase}${branchPhrase}. Highlight active work, blockers, and follow-up items.`;
    case "integration":
      return `Refine the integration search for ${scope}${repoPhrase}${branchPhrase}. Prioritize high-signal matches and summarize why they are relevant.`;
    case "generic":
      return `Search for additional evidence about ${scope}${repoPhrase}${branchPhrase} and summarize the strongest findings.`;
  }
}

export function capEvidenceActions(
  actions: Array<EvidenceRecommendedAction | undefined>,
  max = 3
): EvidenceRecommendedAction[] {
  if (max <= 0) {
    return [];
  }
  const deduped: EvidenceRecommendedAction[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    if (!action) {
      continue;
    }
    const label = clean(action.label);
    if (!label) {
      continue;
    }
    const key = `${action.kind}|${label}|${clean(action.url) ?? ""}|${clean(action.path) ?? ""}|${action.searchType ?? ""}|${action.quickActionId ?? ""}|${clean(action.composerPrompt) ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...action,
      label
    });
    if (deduped.length >= max) {
      break;
    }
  }
  return deduped;
}

function clean(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function repoLabel(owner: string | undefined, repo: string | undefined): string | undefined {
  const normalizedOwner = clean(owner);
  const normalizedRepo = clean(repo);
  if (!normalizedOwner || !normalizedRepo) {
    return undefined;
  }
  return `${normalizedOwner}/${normalizedRepo}`;
}
