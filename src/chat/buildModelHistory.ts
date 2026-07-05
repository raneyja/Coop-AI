import type { ChatMessage } from "./types";

/** Prior turns for model replay — user bubbles use stored modelContent when present. */
export function buildModelHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(0, -1).map((entry) => {
    if (entry.role === "user") {
      return { ...entry, content: entry.modelContent ?? entry.content };
    }
    return entry;
  });
}
