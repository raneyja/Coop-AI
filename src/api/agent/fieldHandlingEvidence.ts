export type FieldHandlingSource = {
  path: string;
  content: string;
  evidenceSource?: string;
};

export type VerifiedFieldHandling = {
  kind: "filtered-input";
  path: string;
  field: string;
  method: string;
  startLine: number;
  endLine: number;
  filterStartLine: number;
  filterEndLine: number;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Identifier aliases, without product names or field-specific exceptions. */
function fieldAliases(fields: string[]): Set<string> {
  return new Set(fields.flatMap((field) => {
    const stem = field.toLowerCase().replace(/_ids?$/, "");
    return [field.toLowerCase(), stem, `${stem}s`];
  }));
}

function hasFieldReject(rows: string[], aliases: Set<string>): boolean {
  const token = new RegExp(`\\b(?:${[...aliases].map(escapeRegex).join("|")})\\b`, "i");
  const guards: Array<{ indent: number; matchingField: boolean }> = [];
  let pendingGuard: { indent: number; matchingField: boolean } | undefined;
  for (const row of rows) {
    const code = row.replace(/#.*$/, "");
    if (!code.trim()) continue;
    const indent = code.match(/^\s*/)?.[0].length ?? 0;
    if (!pendingGuard) {
      while (guards.length && indent <= guards[guards.length - 1]!.indent) guards.pop();
    }
    if (/^\s*(?:if|elif)\b/.test(code)) {
      const guard = { indent, matchingField: token.test(code) };
      guards.push(guard);
      if (!code.trimEnd().endsWith(":")) pendingGuard = guard;
    } else if (pendingGuard) {
      pendingGuard.matchingField ||= token.test(code);
      if (code.trimEnd().endsWith(":")) pendingGuard = undefined;
    }
    if (/\braise\b/.test(code) && (token.test(code) || guards.some((guard) => guard.matchingField))) {
      return true;
    }
  }
  return false;
}

/**
 * Positive evidence of input filtering in a complete Python validation/writer
 * method. This establishes only the shown handling, never a repo-wide absence
 * of errors. Partial snippets, read methods, and indirect helpers fail closed.
 */
export function classifyFieldHandlingEvidence(
  file: FieldHandlingSource,
  askedFields: string[]
): VerifiedFieldHandling | undefined {
  if (file.evidenceSource !== "remote-read" || !askedFields.length) return undefined;
  const numbered = file.content.split("\n");
  const rows = numbered.map((row) => row.replace(/^\d+\|/, ""));
  const aliases = fieldAliases(askedFields);
  for (let start = 0; start < rows.length; start++) {
    const declaration = rows[start]!.match(/^(\s*)def\s+(validate|create|update)\s*\([^)]*\b(data|validated_data)\b[^)]*\)\s*:/);
    if (!declaration) continue;
    const methodIndent = declaration[1]!.length;
    const container = declaration[3]!;
    let end = start + 1;
    while (end < rows.length) {
      const row = rows[end]!;
      if (row.trim() && !row.trimStart().startsWith("#") && (row.match(/^\s*/)?.[0].length ?? 0) <= methodIndent) break;
      end++;
    }
    const methodRows = rows.slice(start, end);
    const codeRows = methodRows.filter((row) => row.trim() && !row.trimStart().startsWith("#"));
    const lastRow = codeRows[codeRows.length - 1] ?? "";
    const bodyIndent = Math.min(...codeRows.slice(1).map((row) => row.match(/^\s*/)?.[0].length ?? 0));
    if (!new RegExp(`^\\s*return\\s+${container}\\s*$`).test(lastRow) ||
        (lastRow.match(/^\s*/)?.[0].length ?? 0) !== bodyIndent) continue;
    if (methodRows.some((row) => /(?:^|\s)(?:\.\.\.|…)(?:\s|$)/.test(row))) continue;
    if (hasFieldReject(methodRows, aliases)) continue;
    const body = methodRows.join("\n");
    const assignment = new RegExp(`\\b${container}\\[(["'])([a-zA-Z_][a-zA-Z0-9_]*)\\1\\]\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\n|$)`, "g");
    for (const match of body.matchAll(assignment)) {
      const field = match[2]!;
      if (!aliases.has(field.toLowerCase())) continue;
      const rhs = match[3]!;
      const read = new RegExp(`\\b${container}(?:\\[(["'])${escapeRegex(field)}\\1\\]|\\.get\\(\\s*(["'])${escapeRegex(field)}\\2(?:\\s*[,)]))`);
      const punctuation = rhs.replace(/(["'])(?:\\.|(?!\1).)*\1/g, "").replace(/#.*$/gm, "");
      let depth = 0;
      let balanced = true;
      for (const char of punctuation) {
        if (char === "(") depth++;
        if (char === ")" && --depth < 0) balanced = false;
      }
      if (!balanced || depth !== 0) continue;
      if (!read.test(rhs) || !/\.filter\s*\(/.test(rhs) || !/\.values_list\s*\(/.test(rhs)) continue;
      const lineAt = (offset: number): number => {
        const prefix = numbered[offset]?.match(/^(\d+)\|/);
        return prefix ? Number(prefix[1]) : offset + 1;
      };
      return {
        kind: "filtered-input", path: file.path, field, method: declaration[2]!,
        startLine: lineAt(start), endLine: lineAt(start + methodRows.lastIndexOf(lastRow)),
        filterStartLine: lineAt(start + body.slice(0, match.index).split("\n").length - 1),
        filterEndLine: lineAt(start + body.slice(0, match.index! + match[0].trimEnd().length).split("\n").length - 1)
      };
    }
  }
  return undefined;
}

/** Cite only the proven replacement expression, with original source numbering. */
export function formatVerifiedFieldHandlingAnswer(file: FieldHandlingSource, evidence: VerifiedFieldHandling): string {
  const rows = file.content.split("\n").map((row, index) => ({
    line: Number(row.match(/^(\d+)\|/)?.[1] ?? index + 1),
    code: row.replace(/^\d+\|/, "")
  })).filter(({ line }) => line >= evidence.filterStartLine && line <= evidence.filterEndLine);
  return `In \`${file.path}\`, \`${evidence.method}\` filters the submitted \`${evidence.field}\` and replaces that field with the matching IDs. This method does not show the claimed rejection; the source of the reported error remains unverified.\n\n\`\`\`\n${evidence.filterStartLine}:${evidence.filterEndLine}:${file.path}\n${rows.map(({ code }) => code).join("\n")}\n\`\`\``;
}
