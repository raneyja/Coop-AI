import { isFileCallerQuery } from "../context/fileCallerIntent";
import { isFileHistoryQuery } from "../context/fileHistoryIntent";

/** Cursor-style live todos seeded from an open-file ask — not Distilling theater. */
export function fileAskActivityMessages(query: string | undefined, file?: string): string[] {
  const path = file?.trim();
  const messages: string[] = [];
  if (path) {
    messages.push(`Read \`${path}\``);
  }
  if (isFileCallerQuery(query)) {
    messages.push(path ? `Find files that rely on \`${path}\`` : "Find files that rely on it");
  }
  if (isFileHistoryQuery(query)) {
    messages.push(path ? `Look up who created \`${path}\`` : "Look up who created it");
  }
  return messages;
}
