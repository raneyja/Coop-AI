import type { ChatImageAttachment } from "./types";

/** Backward-compatible alias — paperclip accepts images, documents, and text files. */
export type ChatPaperclipAttachment = ChatImageAttachment;

export type PaperclipAttachmentKind = "image" | "text" | "pdf" | "binary";

export const MAX_PAPERCLIP_ATTACHMENTS = 4;
export const MAX_PAPERCLIP_BYTES = 5 * 1024 * 1024;
export const MAX_PAPERCLIP_TEXT_CHARS = 120_000;

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const ACCEPTED_DOCUMENT_TYPES = new Set(["application/pdf"]);
const ACCEPTED_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/x-markdown",
  "application/json",
  "application/xml",
  "text/xml",
  "application/yaml",
  "text/yaml",
  "application/x-yaml"
]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".env",
  ".toml",
  ".ini",
  ".log",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".vue",
  ".svelte",
  ".swift",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".php",
  ".r",
  ".lua",
  ".dockerfile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig"
]);

export function fileExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

export function isAcceptedPaperclipMimeType(mimeType: string, name: string): boolean {
  if (ACCEPTED_IMAGE_TYPES.has(mimeType)) {
    return true;
  }
  if (ACCEPTED_DOCUMENT_TYPES.has(mimeType)) {
    return true;
  }
  if (mimeType.startsWith("text/") || ACCEPTED_TEXT_MIME_TYPES.has(mimeType)) {
    return true;
  }
  if (TEXT_EXTENSIONS.has(fileExtension(name))) {
    return true;
  }
  return false;
}

export function paperclipAttachmentKind(mimeType: string, name: string): PaperclipAttachmentKind {
  if (ACCEPTED_IMAGE_TYPES.has(mimeType) || mimeType.startsWith("image/")) {
    return "image";
  }
  if (ACCEPTED_DOCUMENT_TYPES.has(mimeType)) {
    return "pdf";
  }
  if (
    mimeType.startsWith("text/") ||
    ACCEPTED_TEXT_MIME_TYPES.has(mimeType) ||
    TEXT_EXTENSIONS.has(fileExtension(name))
  ) {
    return "text";
  }
  return "binary";
}

export function isMultimodalPaperclipAttachment(attachment: ChatPaperclipAttachment): boolean {
  const kind = paperclipAttachmentKind(attachment.mimeType, attachment.name);
  return kind === "image" || kind === "pdf";
}

export function isVisionWeightedPaperclipAttachment(attachment: ChatPaperclipAttachment): boolean {
  return paperclipAttachmentKind(attachment.mimeType, attachment.name) === "image";
}

export function decodeDataUrlText(dataUrl: string): string | undefined {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    return undefined;
  }
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!meta.includes(";base64")) {
    try {
      return decodeURIComponent(payload);
    } catch {
      return undefined;
    }
  }
  try {
    return Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

export function paperclipAttachmentTextContent(attachment: ChatPaperclipAttachment): string | undefined {
  if (paperclipAttachmentKind(attachment.mimeType, attachment.name) !== "text") {
    return undefined;
  }
  const decoded = decodeDataUrlText(attachment.dataUrl);
  if (decoded === undefined) {
    return undefined;
  }
  if (decoded.length > MAX_PAPERCLIP_TEXT_CHARS) {
    return `${decoded.slice(0, MAX_PAPERCLIP_TEXT_CHARS)}\n\n[truncated — file exceeds ${MAX_PAPERCLIP_TEXT_CHARS} characters]`;
  }
  return decoded;
}

export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function isValidPaperclipDataUrl(dataUrl: string): boolean {
  return typeof dataUrl === "string" && dataUrl.startsWith("data:") && dataUrl.includes(",");
}

/** System prompt rule — injected only when the turn (or prior history) carries paperclip uploads. */
export const USER_PAPERCLIP_ATTACHMENTS_SYSTEM_RULE = `When the user message includes a ## User-attached files (paperclip) section, those files were uploaded from outside the editor via the paperclip control — not from the repository index or @-mention picker. Use the listed file contents and any multimodal document/image payloads sent with the message. Do not treat them as @-attached repo paths or \`<local_files>\` / \`<file_content>\` blocks inside \`<attached_context>\`.`;

function attachmentDeliveryNote(kind: PaperclipAttachmentKind): string {
  switch (kind) {
    case "image":
      return "image (sent as multimodal content)";
    case "pdf":
      return "PDF (sent as document content when supported)";
    case "text":
      return "text (content inlined below)";
    default:
      return "file";
  }
}

/** Append a ## User-attached files block so the model knows paperclip uploads are in the turn. */
export function appendUserPaperclipAttachmentsPrompt(
  message: string,
  attachments?: ChatPaperclipAttachment[]
): string {
  if (!attachments?.length) {
    return message;
  }

  const lines: string[] = [];
  const trimmed = message.trim();
  if (trimmed) {
    lines.push(trimmed);
    lines.push("");
  }

  const heading =
    attachments.length === 1
      ? "## User-attached file (paperclip)"
      : "## User-attached files (paperclip)";
  lines.push(heading);
  lines.push(
    attachments.length === 1
      ? "The user attached 1 file from outside the editor using the paperclip control. Treat it as primary context when the question refers to it."
      : `The user attached ${attachments.length} files from outside the editor using the paperclip control. Treat them as primary context when the question refers to them.`
  );

  const textBlocks: string[] = [];
  for (const attachment of attachments) {
    const kind = paperclipAttachmentKind(attachment.mimeType, attachment.name);
    lines.push(`- ${attachment.name} (${attachmentDeliveryNote(kind)})`);
    const textContent = paperclipAttachmentTextContent(attachment);
    if (textContent !== undefined) {
      textBlocks.push(`<file_content path="${attachment.name}">`);
      textBlocks.push(textContent);
      textBlocks.push("</file_content>");
    }
  }

  if (textBlocks.length > 0) {
    lines.push("");
    lines.push("<user_attached_files>");
    lines.push("Authoritative text from paperclip uploads:");
    lines.push(...textBlocks);
    lines.push("</user_attached_files>");
  }

  return lines.join("\n");
}

/** @deprecated Use appendUserPaperclipAttachmentsPrompt */
export const appendUserImageAttachmentsPrompt = appendUserPaperclipAttachmentsPrompt;

/** @deprecated Use USER_PAPERCLIP_ATTACHMENTS_SYSTEM_RULE */
export const USER_IMAGE_ATTACHMENTS_SYSTEM_RULE = USER_PAPERCLIP_ATTACHMENTS_SYSTEM_RULE;
