export type PatchEventType =
  | "edit.patch_parsed"
  | "edit.patch_applied"
  | "edit.patch_failed"
  | "edit.patch_undone"
  | "edit.patch_rejected";

export type PatchEventPayload = Record<string, unknown>;

type PatchEventHandler = (eventType: PatchEventType, payload?: PatchEventPayload) => void;

let handler: PatchEventHandler | undefined;

export function setPatchEventHandler(fn: PatchEventHandler): void {
  handler = fn;
}

export function emitPatchEvent(eventType: PatchEventType, payload?: PatchEventPayload): void {
  handler?.(eventType, payload);
}
