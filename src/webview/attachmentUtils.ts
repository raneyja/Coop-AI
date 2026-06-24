import type { ChatImageAttachment } from "../chat/types";
import {
  isAcceptedPaperclipMimeType,
  MAX_PAPERCLIP_ATTACHMENTS,
  MAX_PAPERCLIP_BYTES
} from "../chat/paperclipAttachments";

export { MAX_PAPERCLIP_ATTACHMENTS as MAX_IMAGE_ATTACHMENTS, MAX_PAPERCLIP_BYTES as MAX_IMAGE_BYTES };

export function createAttachmentId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function readAttachmentFile(file: File): Promise<ChatImageAttachment> {
  if (!isAcceptedPaperclipMimeType(file.type, file.name)) {
    throw new Error("Unsupported file type. Attach images, PDFs, or text files (e.g. .md, .txt, .json).");
  }
  if (file.size > MAX_PAPERCLIP_BYTES) {
    throw new Error("Each file must be 5 MB or smaller.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  return {
    id: createAttachmentId(),
    name: file.name || "attachment",
    mimeType: file.type || "application/octet-stream",
    dataUrl
  };
}

export async function readAttachmentFiles(files: FileList | File[]): Promise<ChatImageAttachment[]> {
  const attachments: ChatImageAttachment[] = [];
  for (const file of Array.from(files)) {
    if (!isAcceptedPaperclipMimeType(file.type, file.name)) {
      continue;
    }
    attachments.push(await readAttachmentFile(file));
  }
  return attachments;
}

/** @deprecated Use readAttachmentFile */
export const readImageFile = readAttachmentFile;

/** @deprecated Use readAttachmentFiles */
export const readImageFiles = readAttachmentFiles;

export function mergeAttachments(
  current: ChatImageAttachment[],
  incoming: ChatImageAttachment[],
  onError?: (message: string) => void
): ChatImageAttachment[] {
  const next = [...current];
  for (const attachment of incoming) {
    if (next.length >= MAX_PAPERCLIP_ATTACHMENTS) {
      onError?.(`You can attach up to ${MAX_PAPERCLIP_ATTACHMENTS} files per message.`);
      break;
    }
    next.push(attachment);
  }
  return next;
}

export async function attachmentsFromClipboard(
  clipboardData: DataTransfer | null
): Promise<ChatImageAttachment[]> {
  if (!clipboardData) {
    return [];
  }

  const files = clipboardData.files;
  if (files.length > 0) {
    return readAttachmentFiles(files);
  }

  const attachments: ChatImageAttachment[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (!file || !isAcceptedPaperclipMimeType(file.type, file.name)) {
      continue;
    }
    attachments.push(await readAttachmentFile(file));
  }
  return attachments;
}

export async function attachmentsFromDataTransfer(dataTransfer: DataTransfer | null): Promise<ChatImageAttachment[]> {
  if (!dataTransfer) {
    return [];
  }
  return readAttachmentFiles(dataTransfer.files);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read file."));
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}
