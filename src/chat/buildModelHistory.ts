import type { ChatMessage } from "./types";

function withoutActivity(entry: ChatMessage): ChatMessage {
  if (!entry.activity && !entry.patchCard) {
    return entry;
  }
  const { activity: _activity, patchCard, ...rest } = entry;
  if (entry.role === "assistant" && patchCard?.status === "rejected") {
    return { ...rest, content: "The preceding edit proposal was rejected and was not applied." };
  }
  return rest;
}

/** Prior turns for model replay — user bubbles use stored modelContent when present. */
export function buildModelHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(0, -1).filter((entry) => !entry.cancelled).map((entry) => {
    if (entry.role === "user") {
      return withoutActivity({ ...entry, content: entry.modelContent ?? entry.content });
    }
    return withoutActivity(entry);
  });
}
