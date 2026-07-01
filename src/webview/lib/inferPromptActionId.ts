import { parseSlashCommand } from "../../context/slashCommands";
import type { QuickActionId } from "../types";

/** Infers a quick-action id when the template starts with a recognized action slash command. */
export function inferActionIdFromTemplate(template: string): QuickActionId | undefined {
  const parsed = parseSlashCommand(template.trim());
  if (parsed?.def.target.kind === "action") {
    return parsed.def.target.actionId;
  }
  return undefined;
}
