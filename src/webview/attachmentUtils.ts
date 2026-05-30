import type { ChatImageAttachment } from "../chat/types";

export const MAX_IMAGE_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function createAttachmentId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isAcceptedImageType(mimeType: string): boolean {
  return ACCEPTED_IMAGE_TYPES.has(mimeType);
}

export async function readImageFile(file: File): Promise<ChatImageAttachment> {
  if (!isAcceptedImageType(file.type)) {
    throw new Error("Only PNG, JPEG, GIF, and WebP images are supported.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Each image must be 5 MB or smaller.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  return {
    id: createAttachmentId(),
    name: file.name || "image",
    mimeType: file.type,
    dataUrl
  };
}

export async function readImageFiles(files: FileList | File[]): Promise<ChatImageAttachment[]> {
  const attachments: ChatImageAttachment[] = [];
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) {
      continue;
    }
    attachments.push(await readImageFile(file));
  }
  return attachments;
}

export function mergeAttachments(
  current: ChatImageAttachment[],
  incoming: ChatImageAttachment[],
  onError?: (message: string) => void
): ChatImageAttachment[] {
  const next = [...current];
  for (const attachment of incoming) {
    if (next.length >= MAX_IMAGE_ATTACHMENTS) {
      onError?.(`You can attach up to ${MAX_IMAGE_ATTACHMENTS} images per message.`);
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
    return readImageFiles(files);
  }

  const attachments: ChatImageAttachment[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    attachments.push(await readImageFile(file));
  }
  return attachments;
}

export async function attachmentsFromDataTransfer(dataTransfer: DataTransfer | null): Promise<ChatImageAttachment[]> {
  if (!dataTransfer) {
    return [];
  }
  return readImageFiles(dataTransfer.files);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image file."));
    };
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}
