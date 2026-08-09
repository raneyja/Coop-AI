/**
 * Dual-repo compare: explicit evidence from exactly two indexed repos in one turn.
 * Isolation: never silent-merge sticky Use-repo #3 or local Extension Host (Coop) paths.
 */
import type { CodeHostProviderPreference } from "../chat/types";
import { WORKSPACE_LOCAL_REPO_ID } from "../chat/mentionSearchMerge";
import { coordinatesFromRepoId, repoIdFromCoordinates } from "../api/codeHosts/types";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";
import {
  filterCodeEvidenceToActiveRepo,
  parseRepoIdCoords,
  repoSlug,
  sameRepoCoords,
  type CodeEvidenceSnippet,
  type RepoCoords
} from "../workspace/repoEvidenceIsolation";

export const DUAL_REPO_COMPARE_MAX_FILES_PER_SIDE = 2;

export const DUAL_REPO_COMPARE_USAGE =
  "Usage: /compare <repo-a> <repo-b> <topic> — example: /compare plane documenso auth and tenancy";

export type DualRepoCompareTarget = {
  owner: string;
  repo: string;
  repoId: string;
  provider: CodeHostProviderPreference;
};

export type DualRepoComparePlan = {
  left: DualRepoCompareTarget;
  right: DualRepoCompareTarget;
  topic: string;
};

export type DualRepoSideEvidence = {
  repoId: string;
  owner: string;
  repo: string;
  files: Array<{ path: string; repoId: string; content: string; truncated?: boolean }>;
  note?: string;
};

export type DualRepoCompareEvidence = {
  source: "dual-repo-compare";
  left: DualRepoSideEvidence;
  right: DualRepoSideEvidence;
  topic: string;
  /** Sticky Use-repo when it was neither compare target (explicitly excluded). */
  stickyRepoExcluded?: string;
};

export type ParseDualRepoCompareResult =
  | { ok: true; plan: DualRepoComparePlan }
  | { ok: false; error: string };

export type ResolveCompareRepoOptions = {
  catalogRepoIds: string[];
  defaultOwner?: string;
  defaultProvider?: CodeHostProviderPreference;
};

/** Split `/compare` args into two repo tokens + remaining topic. */
export function splitCompareArgTokens(args: string): {
  leftToken?: string;
  rightToken?: string;
  topic: string;
} {
  const tokens = args
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length < 2) {
    return { leftToken: tokens[0], rightToken: tokens[1], topic: "" };
  }
  return {
    leftToken: tokens[0],
    rightToken: tokens[1],
    topic: tokens.slice(2).join(" ").trim()
  };
}

/**
 * Resolve a user token (`plane`, `owner/repo`, `github:owner/repo`) to a compare target.
 * Prefers an exact / suffix match in the indexed catalog; else defaultOwner + name.
 */
export function resolveCompareRepoToken(
  token: string,
  options: ResolveCompareRepoOptions
): DualRepoCompareTarget | undefined {
  const raw = token.trim();
  if (!raw) {
    return undefined;
  }

  const provider = options.defaultProvider ?? "github";
  const catalog = options.catalogRepoIds.map((id) => id.trim()).filter(Boolean);

  const asRepoId = normalizeToRepoId(raw, provider);
  if (asRepoId) {
    const fromCatalog = catalog.find((id) => sameRepoCoords({ repoId: id }, { repoId: asRepoId }));
    if (fromCatalog) {
      return targetFromRepoId(fromCatalog);
    }
    // Explicit owner/repo always allowed; missing index → empty side + honest gap note.
    if (looksFullyQualified(raw)) {
      return targetFromRepoId(asRepoId);
    }
  }

  const needle = raw.toLowerCase().replace(/^[^:]+:/, "");
  const bySuffix = catalog.filter((id) => {
    const coords = parseRepoIdCoords(id);
    const slug = repoSlug(coords);
    if (!slug) {
      return false;
    }
    return slug === needle || slug.endsWith(`/${needle}`) || coords.repo?.toLowerCase() === needle;
  });
  if (bySuffix.length === 1) {
    return targetFromRepoId(bySuffix[0]!);
  }
  if (bySuffix.length > 1 && options.defaultOwner?.trim()) {
    const prefer = bySuffix.find((id) =>
      sameRepoCoords({ repoId: id }, { owner: options.defaultOwner, repo: needle })
    );
    if (prefer) {
      return targetFromRepoId(prefer);
    }
  }
  if (bySuffix.length > 1) {
    return undefined;
  }

  const owner = options.defaultOwner?.trim();
  if (owner && /^[A-Za-z0-9._-]+$/.test(raw)) {
    const synthetic = repoIdFromCoordinates({
      provider,
      owner,
      repo: raw
    });
    const inCatalog = catalog.find((id) => sameRepoCoords({ repoId: id }, { repoId: synthetic }));
    // Prefer catalog id when present; otherwise allow defaultOwner/name so /compare
    // works when the workspace list is incomplete (search returns empty → honest gap).
    return targetFromRepoId(inCatalog ?? synthetic);
  }

  return undefined;
}

function looksFullyQualified(token: string): boolean {
  return token.includes("/") || token.includes(":");
}

function normalizeToRepoId(token: string, provider: CodeHostProviderPreference): string | undefined {
  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^(github|gitlab|bitbucket):[^/]+\/.+/.test(trimmed)) {
    return trimmed;
  }
  if (/^[^/:\s]+\/[^/\s]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split("/");
    if (owner && repo) {
      return repoIdFromCoordinates({ provider, owner, repo });
    }
  }
  return undefined;
}

function targetFromRepoId(repoId: string): DualRepoCompareTarget | undefined {
  const coords = coordinatesFromRepoId(repoId);
  if (!coords?.owner || !coords.repo) {
    return undefined;
  }
  return {
    owner: coords.owner,
    repo: coords.repo,
    repoId: repoIdFromCoordinates(coords),
    provider: coords.provider
  };
}

export function parseDualRepoCompareArgs(
  args: string,
  options: ResolveCompareRepoOptions
): ParseDualRepoCompareResult {
  const { leftToken, rightToken, topic } = splitCompareArgTokens(args);
  if (!leftToken || !rightToken) {
    return { ok: false, error: DUAL_REPO_COMPARE_USAGE };
  }

  const left = resolveCompareRepoToken(leftToken, options);
  const right = resolveCompareRepoToken(rightToken, options);
  if (!left) {
    return {
      ok: false,
      error: `Could not resolve repo "${leftToken}". Use an indexed name or owner/repo. ${DUAL_REPO_COMPARE_USAGE}`
    };
  }
  if (!right) {
    return {
      ok: false,
      error: `Could not resolve repo "${rightToken}". Use an indexed name or owner/repo. ${DUAL_REPO_COMPARE_USAGE}`
    };
  }
  if (sameRepoCoords(left, right)) {
    return {
      ok: false,
      error: "Pick two different repositories to compare."
    };
  }

  const focus = topic.trim() || "architecture and key differences";
  return { ok: true, plan: { left, right, topic: focus } };
}

export function dualRepoCompareHistoryContent(plan: DualRepoComparePlan): string {
  return `/compare ${plan.left.repo} ${plan.right.repo} ${plan.topic}`.trim();
}

export function dualRepoCompareUserMessage(plan: DualRepoComparePlan): string {
  return (
    `Compare ${plan.left.owner}/${plan.left.repo} and ${plan.right.owner}/${plan.right.repo} ` +
    `on: ${plan.topic}. Cite indexed evidence from both repositories and contrast them. ` +
    `If evidence is missing on one side, say so for that side — do not invent or use a third repo.`
  );
}

/** Absolute disk / workspace-local / Coop extension paths must never enter compare evidence. */
export function isRejectedCompareEvidencePath(path: string, repoId?: string): boolean {
  if (repoId?.trim() === WORKSPACE_LOCAL_REPO_ID) {
    return true;
  }
  if (isOsAbsoluteDiskPath(path)) {
    return true;
  }
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  if (normalized.startsWith("src/chat/") || normalized.startsWith("src/webview/")) {
    return true;
  }
  return false;
}

export function filterSnippetsForCompareSide<T extends CodeEvidenceSnippet>(
  files: T[],
  side: RepoCoords
): T[] {
  return filterCodeEvidenceToActiveRepo(files, side, { allowMissingRepoId: false }).filter(
    (file) => !isRejectedCompareEvidencePath(file.path, file.repoId)
  );
}

/**
 * Assemble dual evidence. Only `left` and `right` repoIds are allowed.
 * Sticky Use-repo is recorded when it is a third repo (never merged silently).
 */
export function assembleDualRepoCompareEvidence(options: {
  plan: DualRepoComparePlan;
  leftFiles: CodeEvidenceSnippet[];
  rightFiles: CodeEvidenceSnippet[];
  stickyRepoId?: string;
}): DualRepoCompareEvidence {
  const { plan } = options;
  const leftFiltered = filterSnippetsForCompareSide(options.leftFiles, plan.left).map((file) => ({
    path: file.path,
    repoId: file.repoId?.trim() || plan.left.repoId,
    content: file.content ?? "",
    truncated: undefined as boolean | undefined
  }));
  const rightFiltered = filterSnippetsForCompareSide(options.rightFiles, plan.right).map((file) => ({
    path: file.path,
    repoId: file.repoId?.trim() || plan.right.repoId,
    content: file.content ?? "",
    truncated: undefined as boolean | undefined
  }));

  // Defensive: drop any snippet that somehow landed on the wrong side bag.
  const allowed = [plan.left, plan.right];
  const keepAllowed = <T extends { path: string; repoId: string; content: string }>(
    files: T[],
    side: DualRepoCompareTarget
  ): T[] =>
    files.filter(
      (file) =>
        sameRepoCoords({ repoId: file.repoId }, side) &&
        allowed.some((a) => sameRepoCoords({ repoId: file.repoId }, a)) &&
        !isRejectedCompareEvidencePath(file.path, file.repoId) &&
        file.content.trim().length > 0
    );

  const leftKeep = keepAllowed(leftFiltered, plan.left).slice(0, DUAL_REPO_COMPARE_MAX_FILES_PER_SIDE);
  const rightKeep = keepAllowed(rightFiltered, plan.right).slice(
    0,
    DUAL_REPO_COMPARE_MAX_FILES_PER_SIDE
  );

  let stickyRepoExcluded: string | undefined;
  const sticky = options.stickyRepoId?.trim();
  if (
    sticky &&
    !sameRepoCoords({ repoId: sticky }, plan.left) &&
    !sameRepoCoords({ repoId: sticky }, plan.right)
  ) {
    stickyRepoExcluded = sticky;
  }

  return {
    source: "dual-repo-compare",
    topic: plan.topic,
    stickyRepoExcluded,
    left: {
      repoId: plan.left.repoId,
      owner: plan.left.owner,
      repo: plan.left.repo,
      files: leftKeep,
      note:
        leftKeep.length === 0
          ? `No indexed code sample matched “${plan.topic}” in ${plan.left.owner}/${plan.left.repo}.`
          : undefined
    },
    right: {
      repoId: plan.right.repoId,
      owner: plan.right.owner,
      repo: plan.right.repo,
      files: rightKeep,
      note:
        rightKeep.length === 0
          ? `No indexed code sample matched “${plan.topic}” in ${plan.right.owner}/${plan.right.repo}.`
          : undefined
    }
  };
}

/** Repo ids present in assembled dual evidence (for tests / guards). */
export function dualCompareEvidenceRepoIds(evidence: DualRepoCompareEvidence): string[] {
  const ids = new Set<string>();
  ids.add(evidence.left.repoId);
  ids.add(evidence.right.repoId);
  for (const file of evidence.left.files) {
    if (file.repoId) {
      ids.add(file.repoId);
    }
  }
  for (const file of evidence.right.files) {
    if (file.repoId) {
      ids.add(file.repoId);
    }
  }
  return [...ids];
}

export function formatDualRepoCompareForLlm(evidence: DualRepoCompareEvidence): string[] {
  const lines: string[] = [];
  lines.push(`<repo_compare topic="${escapeAttr(evidence.topic)}">`);
  lines.push(
    "Compare ONLY these two indexed repositories. Cite paths from both sides and contrast them. " +
      "If a side has a note about missing evidence, say so for that side. " +
      "Never use a third repository or the local Extension Host workspace as primary evidence."
  );
  if (evidence.stickyRepoExcluded) {
    lines.push(
      `<excluded_sticky_repo repoId="${escapeAttr(evidence.stickyRepoExcluded)}" />` +
        " <!-- sticky Use-repo was not a compare target; do not cite it -->"
    );
  }
  lines.push(...formatCompareSide(evidence.left));
  lines.push(...formatCompareSide(evidence.right));
  lines.push("</repo_compare>");
  return lines;
}

function formatCompareSide(side: DualRepoSideEvidence): string[] {
  const label = `${side.owner}/${side.repo}`;
  const lines: string[] = [
    `<repo side="${escapeAttr(label)}" repoId="${escapeAttr(side.repoId)}">`
  ];
  if (side.note) {
    lines.push(`<note>${side.note}</note>`);
  }
  for (const file of side.files) {
    const truncated = file.truncated ? ' truncated="true"' : "";
    lines.push(`<file_content path="${escapeAttr(file.path)}" repo="${escapeAttr(file.repoId)}"${truncated}>`);
    lines.push(file.content);
    lines.push("</file_content>");
  }
  lines.push("</repo>");
  return lines;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function extractDualRepoCompareEvidence(bundle: unknown): DualRepoCompareEvidence | undefined {
  if (!Array.isArray(bundle)) {
    return undefined;
  }
  for (const entry of bundle) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const evidence = (entry as { data?: { dualRepoCompare?: DualRepoCompareEvidence } }).data
      ?.dualRepoCompare;
    if (evidence?.source === "dual-repo-compare" && evidence.left && evidence.right) {
      return evidence;
    }
  }
  return undefined;
}
