export type HistoryAttachment = {
  basename: string;
  isLocal: boolean;
  title: string;
};

/** Parse a stored mention label (from plainChatHistoryContent / quick-action chips). */
export function parseAttachmentLabel(raw: string): HistoryAttachment {
  const label = raw.trim();
  const localMatch = label.match(/^(.+?) \(local workspace\)$/i);
  if (localMatch) {
    const path = localMatch[1].trim();
    const basename = path.split("/").pop() ?? path;
    return { basename, isLocal: true, title: `${path} · local workspace` };
  }
  const basename = label.split("/").pop() ?? label;
  return { basename, isLocal: false, title: label };
}

function parseAttachedValue(value: string): HistoryAttachment[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseAttachmentLabel);
}

/** True for quick-action / chat scope chip lines: `key: value · key: value`. */
export function isCompactContextChipLine(line: string): boolean {
  return /^[\w ]+: .+( · [\w ]+: .+)*$/.test(line.trim());
}

/** Extract @ attachment chips from quick-action context lines (`file: … · attached: …`). */
export function parseContextLineAttachments(contextLine: string): {
  withoutAttachments: string;
  attachments: HistoryAttachment[];
} {
  const parts = contextLine.split(" · ");
  const meta: string[] = [];
  const attachments: HistoryAttachment[] = [];

  for (const part of parts) {
    const colon = part.indexOf(": ");
    if (colon === -1) {
      meta.push(part);
      continue;
    }
    const key = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 2).trim();
    if (key === "attached") {
      attachments.push(...parseAttachedValue(value));
    } else {
      meta.push(part);
    }
  }

  return { withoutAttachments: meta.join(" · "), attachments };
}

/**
 * Split plain-chat bubble text from stored context / attached chip lines.
 * Supports:
 * - Compact scope chips on any turn: `message\nfile: x · repo: y · branch: z`
 * - Mentions only: `message\nattached: path`
 */
export function splitPlainChatHistoryBody(content: string): {
  message: string;
  contextLine?: string;
  attachments: HistoryAttachment[];
} {
  const trimmed = content.trim();
  if (!trimmed) {
    return { message: "", attachments: [] };
  }

  const newline = trimmed.indexOf("\n");
  if (newline === -1) {
    return { message: trimmed, attachments: [] };
  }

  const message = trimmed.slice(0, newline).trim();
  const rest = trimmed.slice(newline + 1).trim();
  if (!rest) {
    return { message, attachments: [] };
  }

  if (isCompactContextChipLine(rest)) {
    const parsed = parseContextLineAttachments(rest);
    return {
      message,
      contextLine: parsed.withoutAttachments || undefined,
      attachments: parsed.attachments
    };
  }

  const legacyAttached = rest.match(/^attached:\s*(.+)$/s);
  if (legacyAttached) {
    return { message, attachments: parseAttachedValue(legacyAttached[1]) };
  }

  // Multi-line user message with no chip footer — keep full body.
  return { message: trimmed, attachments: [] };
}
