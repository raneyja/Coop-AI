import type { OwnershipScore, SlackPresenceStatus } from "../types/ownership";

export type SlackPresencePartition = {
  resolved: OwnershipScore[];
  unresolved: OwnershipScore[];
  linkedLookupFailed: OwnershipScore[];
};

/** Compact copy for a secondary evidence section — keep collapsed by default. */
export type SlackPresenceViewModel = {
  showSection: boolean;
  /** One line shown when the section is collapsed. */
  collapsedSummary: string;
  /** Optional extra line(s) when expanded — at most one line in practice. */
  detailLine?: string;
  /** Shown when expanded and multiple owners are mapped. */
  resolvedEntries: Array<{ owner: string; label: string }>;
};

export function isSlackPresenceResolved(presence: SlackPresenceStatus | undefined): boolean {
  if (!presence) {
    return false;
  }
  if (presence.slackUserId) {
    return true;
  }
  return presence.state !== "unknown";
}

export function isSlackPresenceLinkedLookupFailed(presence: SlackPresenceStatus | undefined): boolean {
  if (!presence) {
    return false;
  }
  return /linked · slack user not found/i.test(presence.label);
}

export function partitionSlackPresenceScores(scores: OwnershipScore[]): SlackPresencePartition {
  const withPresence = scores.filter((score) => score.presence);
  const resolved: OwnershipScore[] = [];
  const linkedLookupFailed: OwnershipScore[] = [];
  const unresolved: OwnershipScore[] = [];

  for (const score of withPresence) {
    if (isSlackPresenceResolved(score.presence)) {
      resolved.push(score);
      continue;
    }
    if (isSlackPresenceLinkedLookupFailed(score.presence)) {
      linkedLookupFailed.push(score);
      continue;
    }
    unresolved.push(score);
  }

  return { resolved, unresolved, linkedLookupFailed };
}

export function buildSlackPresenceViewModel(scores: OwnershipScore[]): SlackPresenceViewModel {
  const partition = partitionSlackPresenceScores(scores);
  const total =
    partition.resolved.length + partition.unresolved.length + partition.linkedLookupFailed.length;

  if (total === 0) {
    return { showSection: false, collapsedSummary: "", resolvedEntries: [] };
  }

  const resolvedEntries = partition.resolved.map((expert) => ({
    owner: expert.owner,
    label: shortPresenceLabel(expert.presence?.label ?? "Unknown")
  }));
  const unmapped = partition.unresolved.length + partition.linkedLookupFailed.length;

  if (partition.resolved.length === 0) {
    return {
      showSection: true,
      collapsedSummary: compactUnavailableSummary(partition, total),
      detailLine: "Teammate GitHub logins couldn't be matched to Slack automatically",
      resolvedEntries: []
    };
  }

  if (unmapped === 0) {
    if (total === 1) {
      const entry = resolvedEntries[0];
      return {
        showSection: true,
        collapsedSummary: `@${entry.owner} · ${entry.label}`,
        resolvedEntries: []
      };
    }
    return {
      showSection: true,
      collapsedSummary: `${total} mapped in Slack`,
      resolvedEntries,
      detailLine: undefined
    };
  }

  const primary = resolvedEntries[0];
  const collapsedSummary =
    total === 1
      ? `@${primary.owner} · ${primary.label}`
      : `${partition.resolved.length}/${total} mapped · @${primary.owner} ${primary.label}`;

  return {
    showSection: true,
    collapsedSummary,
    detailLine: compactUnmappedDetail(partition.unresolved.length, partition.linkedLookupFailed.length),
    resolvedEntries: partition.resolved.length > 1 ? resolvedEntries : []
  };
}

function compactUnavailableSummary(partition: SlackPresencePartition, total: number): string {
  if (partition.linkedLookupFailed.length > 0 && partition.unresolved.length === 0) {
    return `${partition.linkedLookupFailed.length} linked · not found in Slack`;
  }
  if (total === 1) {
    return "Unavailable · not mapped to Slack";
  }
  return `Unavailable · ${total} owners unmapped`;
}

function compactUnmappedDetail(unresolved: number, linkedLookupFailed: number): string | undefined {
  if (unresolved > 0 && linkedLookupFailed > 0) {
    return `${unresolved} unmapped · ${linkedLookupFailed} linked but not in Slack`;
  }
  if (unresolved > 0) {
    return `${unresolved} other${unresolved === 1 ? "" : "s"} unmapped`;
  }
  if (linkedLookupFailed > 0) {
    return `${linkedLookupFailed} linked · not found in Slack`;
  }
  return undefined;
}

function shortPresenceLabel(label: string): string {
  return label
    .replace(/ · linked$/i, "")
    .replace(/ · inferred$/i, "")
    .replace(/^Active \((.+)\)$/i, "active")
    .replace(/^Away \(last active /i, "away · ")
    .replace(/^Offline \(last active /i, "offline · ")
    .replace(/\)$/, "");
}

/** @deprecated Use buildSlackPresenceViewModel */
export function slackPresenceUnavailableMessage(partition: SlackPresencePartition): string {
  const total =
    partition.unresolved.length + partition.linkedLookupFailed.length + partition.resolved.length;
  return compactUnavailableSummary(partition, total);
}

/** @deprecated Use buildSlackPresenceViewModel */
export function slackPresenceSetupHint(): string {
  return "Teammate GitHub logins couldn't be matched to Slack automatically";
}

/** @deprecated Use buildSlackPresenceViewModel */
export function slackPresenceUnresolvedSummary(count: number): string | undefined {
  if (count <= 0) {
    return undefined;
  }
  return `${count} other${count === 1 ? "" : "s"} unmapped`;
}
