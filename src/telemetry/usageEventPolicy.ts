/**
 * Split Coop usage recording for Marketplace telemetry rules.
 *
 * Product events power Admin, My Usage, and quota. They still send when the user
 * is signed in, even if VS Code telemetry is off.
 *
 * Analytics events (suggested-next-step pills, intent-classifier traces) follow
 * `vscode.env.isTelemetryEnabled`.
 */

export function isProductUsageEvent(eventType: string): boolean {
  if (eventType === "chat.message" || eventType === "chat.completion") {
    return true;
  }
  if (eventType === "lightning.search") {
    return true;
  }
  if (eventType.startsWith("completion.")) {
    return true;
  }
  if (eventType.startsWith("quick_action.")) {
    return true;
  }
  if (eventType.startsWith("edit.")) {
    return true;
  }
  return false;
}

export function shouldRecordUsageEvent(eventType: string, telemetryEnabled: boolean): boolean {
  if (!eventType.trim()) {
    return false;
  }
  if (isProductUsageEvent(eventType)) {
    return true;
  }
  return telemetryEnabled;
}
