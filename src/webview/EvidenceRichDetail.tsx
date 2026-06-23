import React, { useState } from "react";
import type {
  DecisionIntroducingDiffSummary,
  DecisionRationaleRank
} from "../types/decisionTimeline";
import {
  IntegrationResultBadge,
  IntegrationResultCode,
  IntegrationResultCollapsible,
  IntegrationResultSection
} from "./components/IntegrationResultCard";

const COMMON_PATH_PREFIXES = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "packages",
  "docs",
  "scripts",
  "server",
  "client",
  "webview",
  "backend",
  "frontend",
  "test",
  "tests"
]);

type EvidenceTargetParts = {
  file?: string;
  lines?: string;
  repo?: string;
  raw: string;
};

type EvidenceEvolutionLike = {
  commitCountSinceIntroduction?: number;
  recentCommitCount?: number;
  lastModifiedAt?: string;
  lastModifiedAuthor?: string;
};

const RATIONALE_ORDER: Array<DecisionRationaleRank["role"]> = [
  "rationale",
  "provenance",
  "background"
];

export function EvidenceTargetMeta({ label }: { label?: string }): React.ReactElement | null {
  const parsed = parseEvidenceTargetMeta(label);
  if (!parsed) {
    return null;
  }

  const ordered = [
    parsed.file ? { key: "file", value: parsed.file } : undefined,
    parsed.lines ? { key: "lines", value: parsed.lines } : undefined,
    parsed.repo ? { key: "repo", value: parsed.repo } : undefined
  ].filter((part): part is { key: string; value: string } => Boolean(part));

  if (ordered.length === 0) {
    return <span className="coop-result-text--muted">{parsed.raw}</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ordered.map((part, index) => (
        <React.Fragment key={`${part.key}-${part.value}`}>
          {index > 0 ? <span className="coop-result-text--muted">·</span> : null}
          <span className="coop-result-text--muted">{part.value}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

export function EvidenceEvolutionLine({
  evolution,
  label = "Evolution",
  variant = "section"
}: {
  evolution?: EvidenceEvolutionLike;
  label?: string;
  variant?: "section" | "collapsible";
}): React.ReactElement | null {
  const text = summarizeEvidenceEvolution(evolution);
  const [open, setOpen] = useState(false);
  if (!text) {
    return null;
  }

  if (variant === "collapsible") {
    return (
      <IntegrationResultCollapsible
        title={label}
        subtitle={open ? undefined : truncateEvolutionSubtitle(text)}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      >
        <p className="coop-result-text coop-result-text--muted">{text}</p>
      </IntegrationResultCollapsible>
    );
  }

  return (
    <IntegrationResultSection label={label}>
      <p className="coop-result-text coop-result-text--muted">{text}</p>
    </IntegrationResultSection>
  );
}

function truncateEvolutionSubtitle(text: string, max = 72): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

export function EvidenceDiffSummary({
  diff
}: {
  diff?: DecisionIntroducingDiffSummary;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (!diff) {
    return null;
  }

  const patchStats = [
    `${diff.filesChanged} file${diff.filesChanged === 1 ? "" : "s"} changed`,
    diff.insertions !== undefined ? `+${diff.insertions}` : undefined,
    diff.deletions !== undefined ? `-${diff.deletions}` : undefined
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <IntegrationResultCollapsible
      title="What changed originally"
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <p className="coop-result-text coop-result-text--muted">{diff.summary}</p>
      {patchStats ? <p className="coop-result-text coop-result-text--muted">{patchStats}</p> : null}
      {diff.patchExcerpt ? <IntegrationResultCode>{diff.patchExcerpt}</IntegrationResultCode> : null}
    </IntegrationResultCollapsible>
  );
}

export function EvidenceRationaleRanking({
  ranks
}: {
  ranks?: DecisionRationaleRank[];
}): React.ReactElement | null {
  const grouped = groupRationaleByRole(ranks);
  if (grouped.length === 0) {
    return null;
  }

  return (
    <IntegrationResultSection label="Rationale ranking">
      <p className="coop-result-text coop-result-text--muted">rationale &gt; provenance &gt; background</p>
      <ul className="mt-1.5 space-y-1.5">
        {grouped.map((entry) => (
          <li key={entry.role} className="flex flex-wrap items-center gap-2">
            <IntegrationResultBadge tone={entry.role === "provenance" ? "info" : "default"}>
              {roleLabel(entry.role)}
            </IntegrationResultBadge>
            <span className="coop-result-text coop-result-text--muted">{entry.labels.join(" · ")}</span>
          </li>
        ))}
      </ul>
    </IntegrationResultSection>
  );
}

export function resolveEvidenceTargetMetaLabel(
  metaLabel: string | undefined,
  summaryTarget: string | undefined
): string | undefined {
  const meta = cleanValue(metaLabel);
  const target = cleanValue(summaryTarget);
  if (!meta && !target) {
    return undefined;
  }
  if (!meta) {
    return target;
  }
  if (!target) {
    return meta;
  }
  const normalizedMeta = meta.toLowerCase();
  const normalizedTarget = target.toLowerCase();
  if (normalizedMeta.includes(normalizedTarget)) {
    return meta;
  }
  if (normalizedTarget.includes(normalizedMeta)) {
    return target;
  }
  return `${target} · ${meta}`;
}

export function parseEvidenceTargetMeta(label?: string): EvidenceTargetParts | undefined {
  const raw = cleanValue(label);
  if (!raw) {
    return undefined;
  }

  const parts = raw.split("·").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { raw };
  }

  let file: string | undefined;
  let lines: string | undefined;
  let repo: string | undefined;
  const leftovers: string[] = [];

  for (const part of parts) {
    const withLine = splitLineSuffix(part);
    if (!lines && withLine.lines) {
      lines = withLine.lines;
    }
    const candidate = withLine.base;

    if (!repo && looksLikeRepo(candidate)) {
      repo = candidate;
      continue;
    }
    if (!file && isLikelyFileSegment(candidate)) {
      file = candidate;
      continue;
    }
    if (!lines && looksLikeLineLabel(candidate)) {
      lines = normalizeLineLabel(candidate);
      continue;
    }
    leftovers.push(candidate);
  }

  if (!file) {
    file = leftovers.find((part) => isLikelyFileSegment(part));
  }

  if (!repo) {
    repo = leftovers.find((part) => looksLikeRepo(part));
  }

  return { file, lines, repo, raw };
}

export function summarizeEvidenceEvolution(
  evolution?: EvidenceEvolutionLike
): string | undefined {
  if (!evolution) {
    return undefined;
  }
  const touchedCount = evolution.commitCountSinceIntroduction ?? evolution.recentCommitCount;
  if (touchedCount === undefined && !evolution.lastModifiedAt) {
    return undefined;
  }

  const touchedPrefix =
    touchedCount === undefined
      ? "Change activity observed since introduction"
      : `Touched ${touchedCount} ${touchedCount === 1 ? "time" : "times"} since introduction`;

  if (!evolution.lastModifiedAt) {
    return touchedPrefix;
  }

  const formattedDate = formatShortDate(evolution.lastModifiedAt);
  const author = cleanValue(evolution.lastModifiedAuthor);
  return `${touchedPrefix}; last change ${formattedDate}${author ? ` by ${author}` : ""}`;
}

export function groupRationaleByRole(
  ranks: DecisionRationaleRank[] | undefined
): Array<{ role: DecisionRationaleRank["role"]; labels: string[] }> {
  if (!ranks?.length) {
    return [];
  }

  return RATIONALE_ORDER.map((role) => {
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const rank of ranks) {
      if (rank.role !== role) {
        continue;
      }
      const value = cleanValue(rank.label) ?? cleanValue(rank.source);
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      labels.push(value);
    }
    return { role, labels };
  }).filter((entry) => entry.labels.length > 0);
}

function splitLineSuffix(value: string): { base: string; lines?: string } {
  const explicit = value.match(/^(.+?):(\d+)(?:[-–](\d+))?$/);
  if (explicit) {
    const start = explicit[2];
    const end = explicit[3];
    return {
      base: explicit[1],
      lines: `lines ${start}${end && end !== start ? `-${end}` : ""}`
    };
  }
  return { base: value };
}

function looksLikeLineLabel(value: string): boolean {
  return /^lines?\s+\d+([\-–]\d+)?$/i.test(value);
}

function normalizeLineLabel(value: string): string {
  const match = value.match(/^lines?\s+(\d+)(?:[\-–](\d+))?$/i);
  if (!match) {
    return value;
  }
  const start = match[1];
  const end = match[2];
  return `lines ${start}${end && end !== start ? `-${end}` : ""}`;
}

function looksLikeRepo(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return false;
  }
  const [first] = trimmed.split("/");
  return !COMMON_PATH_PREFIXES.has((first ?? "").toLowerCase());
}

function isLikelyFileSegment(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || looksLikeRepo(trimmed)) {
    return false;
  }
  if (trimmed.includes("\\") || trimmed.startsWith("/") || trimmed.startsWith("./")) {
    return true;
  }
  if (/\.[a-zA-Z0-9]{1,8}$/.test(trimmed)) {
    return true;
  }
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length >= 3) {
    return true;
  }
  if (segments.length === 2 && COMMON_PATH_PREFIXES.has(segments[0]!.toLowerCase())) {
    return true;
  }
  return false;
}

function roleLabel(role: DecisionRationaleRank["role"]): string {
  switch (role) {
    case "rationale":
      return "Rationale";
    case "provenance":
      return "Provenance";
    case "background":
      return "Background";
  }
}

function cleanValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatShortDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString().slice(0, 10);
}
