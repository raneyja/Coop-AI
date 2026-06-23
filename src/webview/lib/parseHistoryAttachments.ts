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

/** Split plain-chat bubble text from stored `attached:` chip line. */
export function splitPlainChatHistoryBody(content: string): {
  message: string;
  attachments: HistoryAttachment[];
} {
  const trimmed = content.trim();
  const match = trimmed.match(/\nattached:\s*(.+)$/s);
  if (!match || match.index === undefined) {
    return { message: trimmed, attachments: [] };
  }
  const message = trimmed.slice(0, match.index).trim();
  return { message, attachments: parseAttachedValue(match[1]) };
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
