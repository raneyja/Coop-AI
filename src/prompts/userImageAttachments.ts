import type { ChatImageAttachment } from "../chat/types";

/** System prompt rule — referenced from every non-inline chat use case. */
export const USER_IMAGE_ATTACHMENTS_SYSTEM_RULE = `When the user message includes a ## User-attached images (paperclip) section, those files were uploaded from outside the editor via the paperclip control — not from the repository index or @-mention picker. Analyze the multimodal image content sent alongside that section. Do not treat them as @-attached repo paths or \`<local_files>\` / \`<file_content>\` blocks.`;

/** Append a ## User-attached images block so the model knows paperclip uploads are in the turn. */
export function appendUserImageAttachmentsPrompt(
  message: string,
  attachments?: ChatImageAttachment[]
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
      ? "## User-attached image (paperclip)"
      : "## User-attached images (paperclip)";
  lines.push(heading);
  lines.push(
    attachments.length === 1
      ? "The user attached 1 image from outside the editor using the paperclip control. It is included as multimodal image content alongside this message — inspect it directly when answering."
      : `The user attached ${attachments.length} images from outside the editor using the paperclip control. They are included as multimodal image content alongside this message — inspect them directly when answering.`
  );
  for (const attachment of attachments) {
    lines.push(`- ${attachment.name} (${attachment.mimeType})`);
  }
  lines.push(
    "Do not conflate these uploads with @-attached repository files or `<local_files>` / `<file_content>` blocks in `<attached_context>`."
  );
  return lines.join("\n");
}
