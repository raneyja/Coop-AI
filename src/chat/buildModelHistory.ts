import type { ChatMessage } from "./types";

function withoutActivity(entry: ChatMessage): ChatMessage {
  if (!entry.activity) {
    return entry;
  }
  const { activity: _activity, ...rest } = entry;
  return rest;
}

/** Prior turns for model replay — user bubbles use stored modelContent when present. */
export function buildModelHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(0, -1).map((entry) => {
    if (entry.role === "user") {
      return withoutActivity({ ...entry, content: entry.modelContent ?? entry.content });
    }
    return withoutActivity(entry);
  });
}
