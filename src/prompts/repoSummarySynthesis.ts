import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";
import {
  appendMentionScopePromptSection,
  OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE,
  partitionMentionsForRepoSummary,
  type MentionScopeRef
} from "./mentionScope";
import {
  listRepoSummarySourceLabels,
  listRepoSummarySourcesChecklist,
  repoSummarySourceLabelEntryFiles,
  repoSummarySourceLabelManifest
} from "./repoSummarySourceLabels";

export const REPO_SUMMARY_EVIDENCE_SYSTEM = `You are an expert code architect helping engineers understand a repository.
Summarize architecture, key systems, boundaries, and risks. Prefer evidence from the attached Sources card over speculation.
Cite file paths and use exact \`[Sources: …]\` labels when referencing evidence.
Never attribute @-attached files from other repositories or local workspaces to the target repository's architecture.
${OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE}

${EVIDENCE_CITATION_RULES}`;

export type RepoSummarySynthesisInput = {
  owner: string;
  repo: string;
  branch?: string;
  activeFile?: string;
  summary: RepoSummaryEvidence | Record<string, unknown>;
  userQuestion?: string;
  mentionedFiles?: MentionScopeRef[];
  activeRepoId?: string;
};

export function buildRepoSummarySynthesisUserPrompt(input: RepoSummarySynthesisInput): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(
    input.userQuestion?.trim() ||
      `Explain the overall architecture of ${input.owner}/${input.repo} for a new engineer joining the team.`
  );
  lines.push("");
  lines.push("## Scope");
  lines.push(`- Repository: ${input.owner}/${input.repo}`);
  if (input.branch) {
    lines.push(`- Branch: ${input.branch}`);
  }
  if (input.activeFile) {
    lines.push(`- Active editor file (context only, not the whole repo): ${input.activeFile}`);
  }
  lines.push("");
  lines.push("## Instructions");
  lines.push(
    "Synthesize a **repository-wide** overview using `<repo_entry_files>`, `<graph_context>`, and manifest metadata in attached context."
  );
  lines.push("Cover major subsystems, entry points, data/backend boundaries, integrations, and top risks.");
  lines.push(
    "For enterprise onboarding, call out deploy/CI entry points (workflows, Docker, deploy docs), external integrations (Slack, Jira, Confluence, OAuth/connect config), and configuration boundaries (env files, secrets handling, feature flags) — only when attached evidence supports them."
  );
  lines.push("Do **not** write a deep dive on only the active editor file unless it illustrates a cross-cutting pattern.");
  appendMentionScopeSection(lines, input);
  lines.push("");
  lines.push("## Repository evidence");
  lines.push(formatRepoSummaryForPrompt(input.summary));
  lines.push("");
  const summaryEvidence = input.summary as RepoSummaryEvidence;
  appendCitationKeysSection(lines, listRepoSummarySourceLabels(summaryEvidence));
  appendSourcesChecklistSection(lines, listRepoSummarySourcesChecklist(summaryEvidence));
  appendEvidenceQualityInstructions(lines);
  appendEvidenceEnrichmentInstructions(lines);
  lines.push("Synthesize from evidence only. Follow the required response structure in your system instructions.");
  lines.push(
    "Close with a one-line pointer to **Find Owner** (CODEOWNERS and commit history) and **Blast Radius** (dependency impact) for paths that need deeper follow-up."
  );
  return lines.join("\n");
}

function appendMentionScopeSection(lines: string[], input: RepoSummarySynthesisInput): void {
  if (!input.mentionedFiles?.length) {
    return;
  }

  const summaryEvidence = input.summary as RepoSummaryEvidence;
  const scope = partitionMentionsForRepoSummary(
    input.mentionedFiles,
    summaryEvidence,
    input.activeRepoId
  );
  appendMentionScopePromptSection(lines, {
    targetLabel: `${input.owner}/${input.repo}`,
    scope,
    inScopeInstruction: "may weight these paths",
    excludeFromLabel: "Architecture / Key subsystems",
    alternateActionLabel: "Understand Repo"
  });
}

export function formatRepoSummaryForPrompt(summary: RepoSummaryEvidence | Record<string, unknown>): string {
  const sections: string[] = [];

  const repository = summary.repository as Record<string, unknown> | undefined;
  if (repository) {
    const parts = [
      repository.description ? `description: ${repository.description}` : undefined,
      repository.language ? `language: ${repository.language}` : undefined,
      repository.defaultBranch ? `defaultBranch: ${repository.defaultBranch}` : undefined
    ].filter(Boolean);
    if (parts.length) {
      sections.push(`### Repository metadata\n${parts.map((p) => `- ${p}`).join("\n")}`);
    }
  }

  const tree = summary.treeOverview as Record<string, unknown> | undefined;
  if (tree) {
    const dirs = Array.isArray(tree.topLevelDirs) ? tree.topLevelDirs.join(", ") : "";
    const files = Array.isArray(tree.topLevelFiles) ? tree.topLevelFiles.join(", ") : "";
    sections.push(`### Top-level layout\n- Directories: ${dirs || "unknown"}\n- Files: ${files || "unknown"}`);
    const srcEntries = tree.srcEntries as Record<string, unknown> | undefined;
    if (srcEntries) {
      const srcDirs = Array.isArray(srcEntries.topLevelDirs) ? srcEntries.topLevelDirs.join(", ") : "";
      const srcFiles = Array.isArray(srcEntries.topLevelFiles) ? srcEntries.topLevelFiles.join(", ") : "";
      sections.push(`### src/ layout\n- Directories: ${srcDirs || "none"}\n- Files: ${srcFiles || "none"}`);
    }
  }

  const manifest = summary.manifest as Record<string, unknown> | undefined;
  if (manifest) {
    const fileCount = manifest.fileCount ?? "unknown";
    const extensions = manifest.extensionBreakdown as Record<string, number> | undefined;
    const extLine = extensions
      ? Object.entries(extensions)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([ext, count]) => `${ext}: ${count}`)
          .join(", ")
      : "unknown";
    sections.push(`### Indexed manifest\n- Files: ${fileCount}\n- Extensions: ${extLine}`);
    const entryPoints = manifest.entryPoints as string[] | undefined;
    if (entryPoints?.length) {
      sections.push(`- Entry points: ${entryPoints.join(", ")}`);
    }
  }

  const entryFiles = summary.entryFiles as Array<{ path: string }> | undefined;
  if (entryFiles?.length) {
    sections.push(`### Anchor files loaded\n${entryFiles.map((f) => `- ${f.path}`).join("\n")}`);
  }

  const commits = summary.recentCommits as Array<{ sha: string; author: string; message: string }> | undefined;
  if (commits?.length) {
    sections.push(
      "### Recent commits\n" +
        commits.slice(0, 5).map((c) => `- ${c.sha} ${c.author}: ${c.message}`).join("\n")
    );
  }

  if (sections.length === 0) {
    return "No structured repository summary was available — rely on attached anchor files and graph context.";
  }

  return sections.join("\n\n");
}
