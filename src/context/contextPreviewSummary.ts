import type { ChatFileMention, RepoContext } from "../chat/types";
import { displayFileLabel, displayRepoLabel, isExplicitRepoScope } from "./contextScope";
import { INTEGRATION_PREVIEW_HINTS } from "./integrationPreviewHints";

export type ContextPreviewChipKind =
  | "file"
  | "selection"
  | "repo"
  | "mention"
  | "integration"
  | "index";

export type ContextPreviewChip = {
  id: string;
  kind: ContextPreviewChipKind;
  label: string;
  detail?: string;
  state: "confirmed" | "estimated";
};

const INTEGRATION_HINTS = INTEGRATION_PREVIEW_HINTS;

function basename(path: string): string {
  const trimmed = path.trim();
  return trimmed.split("/").pop() ?? trimmed;
}

/** Build read-only pre-send context chips from editor scope and draft input. */
export function buildContextPreviewChips(options: {
  context: RepoContext;
  draftMessage?: string;
  mentions?: ChatFileMention[];
  includeIndexHint?: boolean;
}): ContextPreviewChip[] {
  const chips: ContextPreviewChip[] = [];
  const ctx = options.context;
  const filePath = ctx.file?.trim();

  if (filePath) {
    chips.push({
      id: "active-file",
      kind: "file",
      label: displayFileLabel(filePath),
      detail: ctx.fileSource === "remote" ? "remote tab" : undefined,
      state: "confirmed"
    });
  }

  if (ctx.selectedLines && ctx.selectedLines.length === 2) {
    const [start, end] = ctx.selectedLines;
    chips.push({
      id: "selection",
      kind: "selection",
      label: start === end ? `L${start}` : `L${start}–${end}`,
      state: "confirmed"
    });
  }

  const showRepo =
    Boolean(ctx.owner?.trim() && ctx.repo?.trim()) &&
    (isExplicitRepoScope(ctx) || Boolean(filePath));
  if (showRepo && ctx.owner && ctx.repo) {
    chips.push({
      id: "repo",
      kind: "repo",
      label: displayRepoLabel(ctx.owner, ctx.repo),
      detail: ctx.branch?.trim() ? `@ ${ctx.branch.trim()}` : undefined,
      state: "confirmed"
    });
  }

  for (const mention of options.mentions ?? []) {
    chips.push({
      id: `mention:${mention.repoId}:${mention.path}`,
      kind: "mention",
      label: basename(mention.path),
      detail: mention.source === "local" ? "local" : mention.repoId,
      state: "confirmed"
    });
  }

  const query = options.draftMessage?.trim() ?? "";
  for (const hint of INTEGRATION_HINTS) {
    if (query && hint.detect(query)) {
      chips.push({
        id: `integration:${hint.id}`,
        kind: "integration",
        label: hint.label,
        detail: "likely on send",
        state: "estimated"
      });
    }
  }

  if (options.includeIndexHint !== false && showRepo && (options.draftMessage?.trim().length ?? 0) >= 12) {
    chips.push({
      id: "index",
      kind: "index",
      label: "Deep index",
      detail: "when question matches",
      state: "estimated"
    });
  }

  return chips;
}
