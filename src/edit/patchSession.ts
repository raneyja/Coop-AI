import type { FileUndoSnapshot } from "./patchApplier";
import type { ParsedPatchSet } from "./patchParser";

let pendingPatches: ParsedPatchSet | undefined;
let lastUndoStack: FileUndoSnapshot[] | undefined;
let lastEditUserMessage: string | undefined;
let lastAssistantPatchContent: string | undefined;
let lastPatchApplyError: string | undefined;

export function setPendingPatches(patches: ParsedPatchSet): void {
  pendingPatches = patches;
}

export function getPendingPatches(): ParsedPatchSet | undefined {
  return pendingPatches;
}

export function clearPendingPatches(): void {
  pendingPatches = undefined;
}

export function setLastUndoStack(undo: FileUndoSnapshot[]): void {
  lastUndoStack = undo;
}

export function getLastUndoStack(): FileUndoSnapshot[] | undefined {
  return lastUndoStack;
}

export function clearLastUndoStack(): void {
  lastUndoStack = undefined;
}

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
