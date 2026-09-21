import { committedActivitySeeds, type CommittedActivityOptions } from "./committedActivity";
import { IntentEvent, UserIntent } from "./intentDetector";
import type { CodeHostProviderPreference } from "../chat/types";

export const CONTEXT_GATHERING_STEP_MS = 850;

export type ContextGatheringIntegrationConnections = {
  jira?: boolean;
  slack?: boolean;
  teams?: boolean;
  confluence?: boolean;
  notion?: boolean;
  googleDocs?: boolean;
};

export type ContextGatheringMessageOptions = CommittedActivityOptions & {
  codeHostProvider?: CodeHostProviderPreference;
  /** When false, skip code-host estate lines. Estate search is live-only now. */
  codeHostConnected?: boolean;
  integrations?: ContextGatheringIntegrationConnections;
};

function uniqueMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message)) {
      return false;
    }
    seen.add(message);
    return true;
  });
}

export function isPlainChatIntent(event: IntentEvent): boolean {
  return (
    !event.context.buttonClicked &&
    (event.intent === UserIntent.MANUAL_CHAT_SUBMIT || event.intent === UserIntent.HOTKEY_TRIGGERED)
  );
}

/**
 * Seed checklist for work committed on this turn.
 * Live Read / Searched rows still append when a body or tool fetch starts.
 * Do not append fake Distilling/Aggregating rotation.
 */
export function contextGatheringMessagesFor(
  event: IntentEvent,
  options: ContextGatheringMessageOptions = {}
): string[] {
  return uniqueMessages(committedActivitySeeds(event, options));
}
