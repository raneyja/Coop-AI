import type { FileUndoSnapshot } from "./patchApplier";
import type { ParsedPatchSet } from "./patchParser";
import type { PatchCardState } from "../chat/types";

export type PatchRecord = {
  patches: ParsedPatchSet;
  card: PatchCardState;
  undo?: FileUndoSnapshot[];
};

let patchRecordsByMessage = new Map<number, PatchRecord>();
let lastEditUserMessage: string | undefined;
let lastAssistantPatchContent: string | undefined;
let lastPatchApplyError: string | undefined;
let lastPatchMessageTimestamp: number | undefined;
let suppressedMessageTimestamps: number[] = [];

export function setLastEditUserMessage(message: string): void {
  lastEditUserMessage = message;
}

export function getLastEditUserMessage(): string | undefined {
  return lastEditUserMessage;
}

export function setLastAssistantPatchContent(content: string): void {
  lastAssistantPatchContent = content;
}

export function getLastAssistantPatchContent(): string | undefined {
  return lastAssistantPatchContent;
}

export function setLastPatchApplyError(error: string | undefined): void {
  lastPatchApplyError = error;
}

export function getLastPatchApplyError(): string | undefined {
  return lastPatchApplyError;
}

export function setLastPatchMessageTimestamp(timestamp: number | undefined): void {
  lastPatchMessageTimestamp = timestamp;
}

export function getLastPatchMessageTimestamp(): number | undefined {
  return lastPatchMessageTimestamp;
}

export function markMessageMarkdownSuppressed(timestamp: number | undefined): void {
  if (timestamp === undefined || suppressedMessageTimestamps.includes(timestamp)) {
    return;
  }
  suppressedMessageTimestamps = [...suppressedMessageTimestamps, timestamp];
}

export function getSuppressedMessageTimestamps(): number[] {
  return suppressedMessageTimestamps;
}

export function upsertPatchRecord(timestamp: number, patches: ParsedPatchSet, card: PatchCardState): void {
  const existing = patchRecordsByMessage.get(timestamp);
  patchRecordsByMessage.set(timestamp, {
    patches,
    card: { ...card, messageTimestamp: timestamp, suppressMarkdown: true },
    undo: existing?.undo
  });
  markMessageMarkdownSuppressed(timestamp);
  lastPatchMessageTimestamp = timestamp;
}

export function updatePatchRecordCard(timestamp: number, card: PatchCardState): void {
  const existing = patchRecordsByMessage.get(timestamp);
  if (!existing) {
    return;
  }
  patchRecordsByMessage.set(timestamp, {
    ...existing,
    card: { ...card, messageTimestamp: timestamp, suppressMarkdown: true }
  });
  markMessageMarkdownSuppressed(timestamp);
}

export function setPatchRecordUndo(timestamp: number, undo: FileUndoSnapshot[] | undefined): void {
  const existing = patchRecordsByMessage.get(timestamp);
  if (!existing) {
    return;
  }
  patchRecordsByMessage.set(timestamp, { ...existing, undo });
}

export function getPatchRecord(timestamp: number | undefined): PatchRecord | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  return patchRecordsByMessage.get(timestamp);
}

export function listPatchCards(): PatchCardState[] {
  return [...patchRecordsByMessage.values()]
    .map((record) => record.card)
    .filter((card) => card.files.length > 0)
    .sort((a, b) => (a.messageTimestamp ?? 0) - (b.messageTimestamp ?? 0));
}

/** Active pending patches: prefer latest pending record, else last message timestamp. */
export function getPendingPatches(): ParsedPatchSet | undefined {
  const pendingRecords = [...patchRecordsByMessage.values()].filter(
    (record) => record.card.status === "pending"
  );
  if (pendingRecords.length === 0) {
    return undefined;
  }
  pendingRecords.sort(
    (a, b) => (b.card.messageTimestamp ?? 0) - (a.card.messageTimestamp ?? 0)
  );
  return pendingRecords[0]?.patches;
}

export function resolveActivePatchTimestamp(preferred?: number): number | undefined {
  if (preferred !== undefined && patchRecordsByMessage.has(preferred)) {
    return preferred;
  }
  const pending = [...patchRecordsByMessage.entries()]
    .filter(([, record]) => record.card.status === "pending")
    .sort((a, b) => b[0] - a[0]);
  if (pending[0]) {
    return pending[0][0];
  }
  const appliedOrRejected = [...patchRecordsByMessage.entries()]
    .filter(([, record]) => record.card.status === "applied" || record.card.status === "rejected")
    .sort((a, b) => b[0] - a[0]);
  if (appliedOrRejected[0]) {
    return appliedOrRejected[0][0];
  }
  return lastPatchMessageTimestamp;
}

// --- Compatibility shims used by older call sites during transition ---

export function setPendingPatches(patches: ParsedPatchSet): void {
  const timestamp = lastPatchMessageTimestamp;
  if (timestamp === undefined) {
    return;
  }
  const existing = patchRecordsByMessage.get(timestamp);
  if (!existing) {
    return;
  }
  patchRecordsByMessage.set(timestamp, {
    ...existing,
    patches,
    card: { ...existing.card, status: "pending", canUndo: false, appliedFileCount: undefined }
  });
}

export function clearPendingPatches(): void {
  // No-op for global clear — pending is derived from record status.
}

export function setLastAppliedPatches(_patches: ParsedPatchSet | undefined): void {
  // Stored on the message record instead.
}

export function getLastAppliedPatches(): ParsedPatchSet | undefined {
  const timestamp = resolveActivePatchTimestamp();
  return timestamp === undefined ? undefined : patchRecordsByMessage.get(timestamp)?.patches;
}

export function clearLastAppliedPatches(): void {
  // No-op — patches stay on the record for Undo → pending.
}

export function setLastUndoStack(undo: FileUndoSnapshot[]): void {
  const timestamp = resolveActivePatchTimestamp();
  if (timestamp === undefined) {
    return;
  }
  setPatchRecordUndo(timestamp, undo);
}

export function getLastUndoStack(): FileUndoSnapshot[] | undefined {
  const timestamp = resolveActivePatchTimestamp();
  return timestamp === undefined ? undefined : patchRecordsByMessage.get(timestamp)?.undo;
}

export function clearLastUndoStack(): void {
  const timestamp = resolveActivePatchTimestamp();
  if (timestamp === undefined) {
    return;
  }
  setPatchRecordUndo(timestamp, undefined);
}

export function setLastAppliedPatchPreview(state: PatchCardState | undefined): void {
  if (!state?.messageTimestamp) {
    return;
  }
  updatePatchRecordCard(state.messageTimestamp, state);
}

export function getLastAppliedPatchPreview(): PatchCardState | undefined {
  const timestamp = resolveActivePatchTimestamp();
  return timestamp === undefined ? undefined : patchRecordsByMessage.get(timestamp)?.card;
}
