export type IntegrationDocPage = {
  title: string;
};

export type IntegrationDocsResponseContractInput = {
  confluencePages?: IntegrationDocPage[];
  notionPages?: IntegrationDocPage[];
  googleDocs?: IntegrationDocPage[];
  /** Section heading for doc title bullets (default: Architecture). */
  targetSection?: string;
};

/** Require exact attached page/document titles in synthesis prompts when integrations return hits. */
export function appendIntegrationDocsResponseContract(
  lines: string[],
  input: IntegrationDocsResponseContractInput
): void {
  const notionCount = input.notionPages?.length ?? 0;
  const confluenceCount = input.confluencePages?.length ?? 0;
  const googleDocsCount = input.googleDocs?.length ?? 0;
  if (notionCount + confluenceCount + googleDocsCount === 0) {
    return;
  }

  const targetSection = input.targetSection ?? "Architecture";
  lines.push("## Attached documentation (required in response)");
  lines.push(`In **${targetSection}**, name every attached page or document title exactly as listed below:`);
  if (notionCount > 0) {
    lines.push(
      `- **Notion pages reviewed** — exactly ${notionCount} titled bullet(s) in this order: ${input.notionPages!
        .map((page) => page.title)
        .join("; ")}`
    );
  }
  if (confluenceCount > 0) {
    lines.push(
      `- **Confluence pages reviewed** — exactly ${confluenceCount} titled bullet(s) in this order: ${input.confluencePages!
        .map((page) => page.title)
        .join("; ")}`
    );
  }
  if (googleDocsCount > 0) {
    lines.push(
      `- **Google Docs reviewed** — exactly ${googleDocsCount} titled bullet(s) in this order: ${input.googleDocs!
        .map((doc) => doc.title)
        .join("; ")}`
    );
  }
  lines.push("");
}
