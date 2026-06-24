import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import {
  appendCitationKeysSection,
  appendEvidenceEnrichmentInstructions,
  appendEvidenceQualityInstructions,
  appendSourcesChecklistSection,
  appendSupplementarySourceCitationGuardrails,
  appendNarrativeCitationInstructions,
  supplementaryKeysOmittedFromChecklist,
  EVIDENCE_CITATION_RULES
} from "./evidenceSynthesis";
import {
  appendIntegrationDocsResponseContract,
  type IntegrationDocsResponseContractInput
} from "./integrationDocsResponseContract";
import {
  appendMentionScopePromptSection,
  OUT_OF_SCOPE_MENTIONS_SYSTEM_RULE,
  partitionMentionsForRepoSummary,
  type MentionScopeRef
} from "./mentionScope";
import {
  listRepoSummarySourceLabels,
  listRepoSummarySourcesChecklist,
  repoSummarySourceLabelDependencies,
  repoSummarySourceLabelOwnership
} from "./repoSummarySourceLabels";

export const REPO_SUMMARY_EVIDENCE_SYSTEM = `You are an expert code architect helping engineers understand a repository.
Summarize architecture, key systems, boundaries, and risks. Prefer evidence from the attached Sources card over speculation.
Cite file paths in narrative sections; reserve \`[Sources: …]\` labels for the **Sources** footer (at most 1-2 inline in **Summary**).
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
  const activeFile = input.activeFile?.trim();
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
  if (activeFile) {
    lines.push(`- Active editor file (context anchor — answer stays repo-wide): ${activeFile}`);
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
  if (activeFile) {
    lines.push(
      `Include the required **How the open file fits** section for \`${activeFile}\` after **Key subsystems** — role, dependencies, dependents, integration surface, and owners from ## Active file context below. Keep **Architecture** and **Key subsystems** repo-wide; do not turn the whole answer into a file-only deep dive.`
    );
  } else {
    lines.push("Do **not** include **How the open file fits** — no active editor file is in scope.");
  }
  appendMentionScopeSection(lines, input);
  if (activeFile) {
    lines.push("");
    lines.push("## Active file context");
    lines.push(formatActiveFileContextForPrompt(activeFile, input.summary as RepoSummaryEvidence));
  }
  lines.push("");
  lines.push("## Repository evidence");
  lines.push(formatRepoSummaryForPrompt(input.summary));
  lines.push("");
  const summaryEvidence = input.summary as RepoSummaryEvidence;
  appendCitationKeysSection(lines, listRepoSummarySourceLabels(summaryEvidence));
  const sourcesChecklist = listRepoSummarySourcesChecklist(summaryEvidence);
  appendSourcesChecklistSection(lines, sourcesChecklist);
  appendIntegrationDocsResponseContract(lines, integrationDocsFromRepoSummary(summaryEvidence));
  appendNarrativeCitationInstructions(lines);
  appendSupplementarySourceCitationGuardrails(lines, sourcesChecklist, [
    repoSummarySourceLabelOwnership(),
    repoSummarySourceLabelDependencies(),
    ...supplementaryKeysOmittedFromChecklist(listRepoSummarySourceLabels(summaryEvidence), sourcesChecklist)
  ]);
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

function integrationDocsFromRepoSummary(
  summary: RepoSummaryEvidence
): IntegrationDocsResponseContractInput {
  return {
    confluencePages: summary.confluence?.pages,
    notionPages: summary.notion?.pages,
    googleDocs: summary.googleDocs?.documents
  };
}

function pathsReferToSameFile(a: string, b: string): boolean {
  const normalize = (path: string): string => path.replace(/\\/g, "/").replace(/^\.?\//, "");
  return normalize(a) === normalize(b);
}

export function formatActiveFileContextForPrompt(
  activeFile: string,
  summary: RepoSummaryEvidence
): string {
  const sections: string[] = [];

  const anchor = summary.entryFiles?.find((file) => pathsReferToSameFile(file.path, activeFile));
  if (anchor?.content) {
    const excerpt = anchor.content.split("\n").slice(0, 80).join("\n");
    sections.push(
      `### Anchor content (${anchor.truncated ? "truncated" : "excerpt"})\n\`\`\`\n${excerpt}\n\`\`\``
    );
    const imports = extractImportStatements(anchor.content);
    if (imports.length) {
      sections.push(`### Import statements\n${imports.slice(0, 10).map((line) => `- ${line}`).join("\n")}`);
    }
  } else {
    sections.push(
      "No anchor file content was loaded for the open file — infer role from repository evidence and attached entry files only."
    );
  }

  const graph = summary.dependencyGraph;
  if (graph) {
    const graphParts: string[] = [];
    if (graph.entryFile && !pathsReferToSameFile(graph.entryFile, activeFile)) {
      graphParts.push(
        `- Note: dependency graph entry is \`${graph.entryFile}\`, not the open file — cite **Used by** only when paths apply to \`${activeFile}\`.`
      );
    } else {
      if (graph.directDependents?.length) {
        graphParts.push(
          `- Direct dependents (${graph.source ?? "index"}, max 8):\n${graph.directDependents
            .slice(0, 8)
            .map((path) => `  - ${path}`)
            .join("\n")}`
        );
      }
      if (graph.edgeCount !== undefined) {
        graphParts.push(`- Indexed edges: ${graph.edgeCount}`);
      }
      if (graph.indexedFileCount !== undefined) {
        graphParts.push(`- Indexed files: ${graph.indexedFileCount}`);
      }
    }
    if (graphParts.length) {
      sections.push(`### Dependency graph\n${graphParts.join("\n")}`);
    }
  }

  const ownershipLines: string[] = [];
  const related = summary.relatedOwnership;
  if (related?.path && pathsReferToSameFile(related.path, activeFile) && related.owner) {
    ownershipLines.push(
      `- Primary: ${related.owner}${related.completeness ? ` (${related.completeness} completeness)` : ""}`
    );
  }
  const report = summary.ownershipReport;
  if (report?.path && pathsReferToSameFile(report.path, activeFile)) {
    const primary = report.scores.find((score) => score.tier === "primary") ?? report.scores[0];
    if (primary && !ownershipLines.length) {
      ownershipLines.push(`- Primary: ${primary.owner} (${primary.tier})`);
    }
    const secondary = report.scores.filter((score) => score.tier === "secondary").slice(0, 2);
    for (const score of secondary) {
      ownershipLines.push(`- Secondary: ${score.owner}`);
    }
  }
  if (ownershipLines.length) {
    sections.push(`### Ownership\n${ownershipLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function extractImportStatements(content: string): string[] {
  const lines: string[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("*")) {
      continue;
    }
    if (/^(import\s.+from\s+['"]|import\s+['"]|require\(['"]|from\s+['"])/.test(line)) {
      lines.push(line.length > 120 ? `${line.slice(0, 117)}…` : line);
    }
  }
  return lines;
}
