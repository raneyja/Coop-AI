import { isFileCallerQuery } from "../context/fileCallerIntent";
import { isFileHistoryQuery } from "../context/fileHistoryIntent";

/**
 * Live todos for extra file asks (callers / history).
 * Do not invent a Read row — that is recorded only after a body is attached.
 */
export function fileAskActivityMessages(query: string | undefined, file?: string): string[] {
  const path = file?.trim();
  const messages: string[] = [];
  if (isFileCallerQuery(query)) {
    messages.push(path ? `Find files that rely on \`${path}\`` : "Find files that rely on it");
  }
  if (isFileHistoryQuery(query)) {
    messages.push(path ? `Look up who created \`${path}\`` : "Look up who created it");
  }
  return messages;
}
