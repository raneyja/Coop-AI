export type RepoSummarySynthesisInput = {
  owner: string;
  repo: string;
  branch?: string;
  activeFile?: string;
  summary: Record<string, unknown>;
  userQuestion?: string;
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
  lines.push("Do **not** write a deep dive on only the active editor file unless it illustrates a cross-cutting pattern.");
  lines.push("");
  lines.push("## Repository evidence");
  lines.push(formatRepoSummaryForPrompt(input.summary));
  lines.push("");
  lines.push("Synthesize from evidence only. Follow the required response structure in your system instructions.");
  return lines.join("\n");
}

export function formatRepoSummaryForPrompt(summary: Record<string, unknown>): string {
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
    sections.push(`### Entry files loaded\n${entryFiles.map((f) => `- ${f.path}`).join("\n")}`);
  }

  const commits = summary.recentCommits as Array<{ sha: string; author: string; message: string }> | undefined;
  if (commits?.length) {
    sections.push(
      "### Recent commits\n" +
        commits.slice(0, 5).map((c) => `- ${c.sha} ${c.author}: ${c.message}`).join("\n")
    );
  }

  if (sections.length === 0) {
    return "No structured repository summary was available — rely on attached entry files and graph context.";
  }

  return sections.join("\n\n");
}
