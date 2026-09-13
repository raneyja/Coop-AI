/**
 * Timeline ordering for chat messages + Sources cards.
 * Kept separate from ChatStream.tsx so unit tests don't need to load React JSX.
 */

export type TimelineMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  relatedArtifactId?: string;
};

export type TimelineArtifact = {
  id: string;
  timestamp: number;
};

export type TimelineEntry<M extends TimelineMessage = TimelineMessage, A extends TimelineArtifact = TimelineArtifact> =
  | { id: string; type: "message"; timestamp: number; message: M }
  | { id: string; type: "artifact"; timestamp: number; artifact: A };

/**
 * Interleave Sources cards with chat messages.
 * Cards for a turn belong directly above that turn's assistant answer — not dumped at the bottom
 * when only one of several multi-tool cards is linked via relatedArtifactId.
 */
export function buildTimelineEntries<M extends TimelineMessage, A extends TimelineArtifact>(
  messages: M[],
  artifacts: A[]
): TimelineEntry<M, A>[] {
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const emittedArtifacts = new Set<string>();
  const entries: TimelineEntry<M, A>[] = [];

  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const sortedArtifacts = [...artifacts].sort((a, b) => a.timestamp - b.timestamp);

  const emitArtifact = (artifact: A) => {
    if (emittedArtifacts.has(artifact.id)) {
      return;
    }
    entries.push({
      id: `artifact-${artifact.id}`,
      type: "artifact",
      timestamp: artifact.timestamp,
      artifact
    });
    emittedArtifacts.add(artifact.id);
  };

  let lastUserTimestamp = 0;
  for (const message of sortedMessages) {
    if (message.role === "user") {
      lastUserTimestamp = message.timestamp;
    }

    if (message.role === "assistant") {
      // Emit every Sources card created in this user→assistant window (multi-tool turns).
      for (const artifact of sortedArtifacts) {
        if (artifact.timestamp >= lastUserTimestamp && artifact.timestamp <= message.timestamp) {
          emitArtifact(artifact);
        }
      }
    }

    if (message.relatedArtifactId && artifactById.has(message.relatedArtifactId)) {
      emitArtifact(artifactById.get(message.relatedArtifactId)!);
    }

    entries.push({
      id: `msg-${message.timestamp}-${message.content.slice(0, 12)}`,
      type: "message",
      timestamp: message.timestamp,
      message
    });
  }

  for (const artifact of sortedArtifacts) {
    emitArtifact(artifact);
  }

  return entries;
}

export type TimelineRenderGroup<
  M extends TimelineMessage = TimelineMessage,
  A extends TimelineArtifact = TimelineArtifact
> =
  | { type: "message"; entry: Extract<TimelineEntry<M, A>, { type: "message" }> }
  | { type: "sources"; entries: Array<Extract<TimelineEntry<M, A>, { type: "artifact" }>> };

/** Consecutive Sources cards share one Thinking-style fold. */
export function groupTimelineSourceCards<M extends TimelineMessage, A extends TimelineArtifact>(
  entries: TimelineEntry<M, A>[]
): TimelineRenderGroup<M, A>[] {
  const groups: TimelineRenderGroup<M, A>[] = [];
  let pending: Array<Extract<TimelineEntry<M, A>, { type: "artifact" }>> = [];

  const flush = () => {
    if (pending.length === 0) {
      return;
    }
    groups.push({ type: "sources", entries: pending });
    pending = [];
  };

  for (const entry of entries) {
    if (entry.type === "artifact") {
      pending.push(entry);
      continue;
    }
    flush();
    groups.push({ type: "message", entry });
  }
  flush();
  return groups;
}
