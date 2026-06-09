import { parseChatProse } from "./chatProseParser";
import type { ChatInlineNode, ChatProseBlock } from "./chatProseTypes";

function inlineNodesToCopyText(nodes: ChatInlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text;
        case "strong":
          return `**${node.text}**`;
        case "em":
          return `*${node.text}*`;
        case "inline-code":
          return `\`${node.code}\``;
        case "file-link":
          return `\`${node.label}\``;
        case "external-link":
          return `[${node.label}](${node.url})`;
        default:
          return "";
      }
    })
    .join("");
}

function blockToCopyLines(block: ChatProseBlock): string[] {
  switch (block.type) {
    case "section-heading":
      return ["", `**${block.text}**`, ""];
    case "list":
      return block.items.map((item, index) => {
        const body = inlineNodesToCopyText(item.content);
        if (item.marker === "ordered") {
          const order = item.order ?? index + 1;
          return `${order}. ${body}`;
        }
        return `- ${body}`;
      });
    case "paragraph":
      return [inlineNodesToCopyText(block.content)];
    case "code-fence":
      return ["", `\`\`\`${block.language ?? ""}`, block.code, "```", ""];
    case "code-citation":
      return [
        "",
        `${block.path}:${block.startLine}-${block.endLine}`,
        "```",
        block.code,
        "```",
        ""
      ];
    case "jira-ticket-stack":
      return block.tickets.flatMap((ticket) => {
        const lines = [`[${ticket.key}](${ticket.url})`];
        if (ticket.summary) {
          lines.push(ticket.summary);
        }
        for (const field of ticket.fields) {
          lines.push(`${field.label}: ${field.value}`);
        }
        return ["", ...lines, ""];
      });
    default:
      return [];
  }
}

/** Developer-friendly markdown copy — preserves links, file paths, and section structure. */
export function formatChatMessageForCopy(content: string): string {
  if (!content.trim()) {
    return "";
  }

  const document = parseChatProse(content);
  const lines: string[] = [];

  for (const block of document.blocks) {
    const blockLines = blockToCopyLines(block);
    if (blockLines.length === 0) {
      continue;
    }
    if (lines.length > 0 && lines[lines.length - 1] !== "" && blockLines[0] !== "") {
      lines.push("");
    }
    lines.push(...blockLines);
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
