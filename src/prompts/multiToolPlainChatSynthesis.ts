/**
 * Multi-tool plain-chat synthesis (Phase 1).
 * Used when the planner selects 2+ tools (or 1 tool without single-provider routing)
 * and we must NOT steal the turn into Jira-only / Slack-only synthesis.
 */
import type { IntegrationChatProvider } from "../chat/types";
import type { ChatIntentJob } from "../chat/intentPlanner";
import type { IntegrationSearchEvidenceLike } from "../context/integrationEvidenceVisibility";
import {
  appendCitationKeysSection,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection
} from "./evidenceSynthesis";
import {
  integrationSourceLabel,
  listIntegrationSourceLabels,
  listIntegrationSourcesChecklist
} from "./integrationSourceLabels";
import { isDocOrSpecPath, isGeneratedOrVendorPath } from "../indexing/evidencePathNoise";

export type MultiToolIntegrationSnapshot = Partial<
  Record<IntegrationChatProvider, IntegrationSearchEvidenceLike | null | undefined>
>;

export type MultiToolPlainChatInput = {
  userQuestion: string;
  owner?: string;
  repo?: string;
  file?: string;
  tools: IntegrationChatProvider[];
  jobs?: ChatIntentJob[];
  integrations: MultiToolIntegrationSnapshot;
  connected?: Partial<Record<IntegrationChatProvider, boolean>>;
};

const TOOL_TITLE: Record<IntegrationChatProvider, string> = {
  jira: "Jira",
  slack: "Slack",
  teams: "Teams",
  confluence: "Confluence",
  notion: "Notion",
  "google-docs": "Google Docs"
};

function hitSummary(
  provider: IntegrationChatProvider,
  evidence: IntegrationSearchEvidenceLike | null | undefined,
  connected?: boolean
): string {
  const label = TOOL_TITLE[provider];
  if (!evidence) {
    if (connected === false) {
      return `${label}: not connected — search skipped.`;
    }
    if (connected === true) {
      return `${label}: connected but no search result attached (budget or skip).`;
    }
    return `${label}: search not run.`;
  }
  if (evidence.error?.trim()) {
    return `${label}: error — ${evidence.error.trim()}`;
  }
  const issues = evidence.issues?.length ?? 0;
  const messages = evidence.messages?.length ?? 0;
  const pages = evidence.pages?.length ?? 0;
  const docs = evidence.documents?.length ?? 0;
  const parts: string[] = [];
  if (issues) {
    parts.push(`${issues} issue(s)`);
  }
  if (messages) {
    parts.push(`${messages} message(s)`);
  }
  if (pages) {
    parts.push(`${pages} page(s)`);
  }
  if (docs) {
    parts.push(`${docs} doc(s)`);
  }
  if (parts.length === 0) {
    return `${label}: searched — no hits.`;
  }
  return `${label}: ${parts.join(", ")}.`;
}

function resultCount(evidence: IntegrationSearchEvidenceLike | null | undefined): number {
  if (!evidence) {
    return 0;
  }
  return (
    (evidence.issues?.length ?? 0) +
    (evidence.messages?.length ?? 0) +
    (evidence.pages?.length ?? 0) +
    (evidence.documents?.length ?? 0)
  );
}

function evidenceBlock(
  provider: IntegrationChatProvider,
  evidence: IntegrationSearchEvidenceLike | null | undefined
): string {
  if (!evidence) {
    return `(no ${TOOL_TITLE[provider]} evidence attached)`;
  }
  const lines: string[] = [];
  if (evidence.error) {
    lines.push(`error: ${evidence.error}`);
  }
  if (provider === "jira") {
    for (const issue of records(evidence.issues).slice(0, 8)) {
      lines.push(`- ${textField(issue, "key", "issue")}: ${textField(issue, "summary")}`.trim());
    }
  } else if (provider === "slack" || provider === "teams") {
    for (const message of records(evidence.messages).slice(0, 8)) {
      const author =
        provider === "slack"
          ? textField(message, "channelName", "thread")
          : textField(message, "fromUserName", "unknown");
      const body =
        provider === "slack"
          ? textField(message, "text")
          : textField(message, "body");
      lines.push(`- ${author}: ${body.slice(0, 240)}`);
    }
  } else if (provider === "confluence" || provider === "notion") {
    for (const page of records(evidence.pages).slice(0, 8)) {
      const url = textField(page, "htmlUrl");
      lines.push(`- ${textField(page, "title", "page")}${url ? ` (${url})` : ""}`);
    }
  } else {
    for (const doc of records(evidence.documents).slice(0, 8)) {
      const url = textField(doc, "htmlUrl");
      lines.push(`- ${textField(doc, "title", "doc")}${url ? ` (${url})` : ""}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : `(empty ${TOOL_TITLE[provider]} payload)`;
}

function records(items: unknown[] | undefined): Array<Record<string, unknown>> {
  return (items ?? []).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"
  );
}

function textField(record: Record<string, unknown>, field: string, fallback = ""): string {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function buildMultiToolPlainChatUserPrompt(input: MultiToolPlainChatInput): string {
  const repo =
    input.owner && input.repo ? `${input.owner}/${input.repo}` : "the active repository";
  const file = input.file?.trim();
  const summaryLines = input.tools.map((tool) =>
    hitSummary(tool, input.integrations[tool], input.connected?.[tool])
  );

  const evidenceSections = input.tools
    .map((tool) => {
      const title = TOOL_TITLE[tool];
      return [`### ${title}`, evidenceBlock(tool, input.integrations[tool])].join("\n");
    })
    .join("\n\n");

  const lines = [
    "Answer this compound intent-job turn with one synthesis.",
    "Keep each capability tied to its own evidence.",
    "Locate claims require attached remote code bodies; path-only hits are leads, not implementation proof.",
    "Decision claims require the integration evidence below; code alone does not prove a prior decision.",
    "Do not pretend a tool was searched when the snapshot says it was skipped or disconnected.",
    "",
    `Repository: ${repo}`,
    file ? `Active file: ${file}` : undefined,
    input.jobs?.length
      ? `Jobs: ${input.jobs.map((job) => job.capability).join(", ")}`
      : undefined,
    "",
    "## User question",
    input.userQuestion.trim(),
    "",
    "## Integration search summary",
    ...summaryLines,
    "",
    "## Integration evidence",
    evidenceSections
  ]
    .filter((line): line is string => Boolean(line));

  lines.push("");
  const evidencedTools = input.tools.filter((tool) => {
    const evidence = input.integrations[tool];
    return !evidence?.error && resultCount(evidence) > 0;
  });
  appendCitationKeysSection(lines, evidencedTools.flatMap((tool) => listIntegrationSourceLabels(tool)));
  appendSourcesChecklistSection(
    lines,
    evidencedTools.flatMap((tool) => {
      const evidence = input.integrations[tool];
      return listIntegrationSourcesChecklist(tool, {
        error: evidence?.error,
        resultCount: resultCount(evidence)
      });
    })
  );
  appendEvidenceQualityInstructions(lines);
  return lines.join("\n");
}

/** Remove citations and local-workspace advice that contradict attached job evidence. */
export function enrichIntentJobResponse(
  content: string,
  input: Pick<MultiToolPlainChatInput, "tools" | "integrations" | "jobs"> & {
    codePaths?: string[];
  }
): string {
  const hasLocateJob = input.jobs?.some((job) => job.capability === "locate") ?? false;
  const hasDecisionJob = input.jobs?.some((job) => job.capability === "decision") ?? false;
  const hasCodeEvidence = (input.codePaths?.length ?? 0) > 0;
  const hasIntegrationEvidence = input.tools.some(
    (tool) => resultCount(input.integrations[tool]) > 0
  );

  if (hasLocateJob && !hasCodeEvidence && !hasIntegrationEvidence) {
    const lines = [
      "**Answer**",
      "I could not verify either part of this request from the evidence attached to this turn.",
      "",
      "**Code location**",
      "The remote code search did not return a usable implementation file. The attached documentation and path-only hits are not enough to infer where the implementation lives."
    ];
    if (hasDecisionJob) {
      lines.push(
        "",
        "**Decision evidence**",
        ...input.tools.map((tool) => `- ${hitSummary(tool, input.integrations[tool])}`)
      );
    }
    lines.push(
      "",
      "**Gaps**",
      "A follow-up remote search needs a more specific symbol or code term. No local clone or on-disk search is required."
    );
    return lines.join("\n");
  }

  const unavailableLabels = input.tools
    .filter((tool) => {
      const evidence = input.integrations[tool];
      return Boolean(evidence?.error) || resultCount(evidence) === 0;
    })
    .map(integrationSourceLabel);
  const unavailable = new Set(unavailableLabels);
  const allowedPaths = new Set(
    (input.codePaths ?? []).map((path) => path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase())
  );
  const withoutLocalActionSections = stripLocalActionSections(content);

  return withoutLocalActionSections
    .replace(/^\s*(?:\*\*)?Summary(?:\*\*)?\s*:?\s*$/im, "**Answer**")
    .split("\n")
    .filter((line) => ![...unavailable].some((label) => line.includes(label)))
    .filter(
      (line) =>
        !/\b(?:clone (?:the|this) repo(?:sitory)?|git grep|find in path|open (?:a|the) local copy)\b/i.test(
          line
        )
    )
    .filter((line) => !/^\s*(?:[-*]\s*)?(?:rg|grep)\s+/i.test(line))
    .filter((line) => !lineHasUnsupportedRepoPath(line, allowedPaths))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Concrete remote source bodies available to an intent-job writer. */
export function intentJobCodePathsFromBundle(bundle: unknown): string[] {
  const paths: string[] = [];
  for (const entry of Array.isArray(bundle) ? bundle : []) {
    const semantic = (entry as {
      data?: { repoSemanticSearch?: { files?: unknown[] } };
    })?.data?.repoSemanticSearch;
    for (const item of semantic?.files ?? []) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const path = (item as { path?: unknown }).path;
      const body = (item as { content?: unknown }).content;
      if (
        typeof path === "string" &&
        path.trim() &&
        typeof body === "string" &&
        body.trim() &&
        isLikelySourcePath(path) &&
        !isDocOrSpecPath(path) &&
        !isGeneratedOrVendorPath(path)
      ) {
        paths.push(path.trim());
      }
    }
  }
  return [...new Set(paths)];
}

function isLikelySourcePath(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|java|kt|kts|scala|go|rs|py|rb|php|cs|fs|fsx|swift|m|mm|cc|cpp|cxx|h|hpp|sql|jsp|vue|svelte)$/i.test(
    path
  );
}

function stripLocalActionSections(content: string): string {
  const lines = content.split("\n");
  const output: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = line
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\s*\*\*|\*\*\s*$/g, "")
      .trim();
    if (/^(?:next actions?|if you want i can)\b/i.test(heading)) {
      skipping = true;
      continue;
    }
    if (skipping && /^(?:\s*#{1,6}\s+|\s*\*\*[^*]+\*\*\s*$)/.test(line)) {
      skipping = false;
    }
    if (!skipping) {
      output.push(line);
    }
  }
  return output.join("\n");
}

function lineHasUnsupportedRepoPath(line: string, allowedPaths: Set<string>): boolean {
  const candidates =
    line.match(/(?:[\w.-]+\/){2,}[\w.*-]*(?:\.[A-Za-z][A-Za-z0-9]{0,9})?\/?/g) ?? [];
  return candidates.some((candidate) => {
    const normalized = candidate.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/$/, "").toLowerCase();
    return ![...allowedPaths].some(
      (allowed) => allowed === normalized || allowed.startsWith(`${normalized}/`)
    );
  });
}
