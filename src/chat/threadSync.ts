import { assertCoopEndpoint } from "../api/resolveBaseUrl";
import type { ChatThreadRecord } from "./chatThreadStore";
import type { ChatMessage } from "./types";

type SyncOptions = {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  /** Links API-key sync to an org member when git user.email matches their account. */
  getOwnerEmail?: () => Promise<string | undefined>;
};

function messageId(threadId: string, index: number, message: ChatMessage): string {
  const stamp = message.timestamp ? String(message.timestamp) : String(index);
  return `${threadId}-${stamp}-${index}`;
}

function previewFromThread(thread: ChatThreadRecord): string | undefined {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message.role === "user" || message.role === "assistant") {
      const trimmed = message.content.trim().replace(/\s+/g, " ");
      if (trimmed) {
        return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
      }
    }
  }
  return undefined;
}

/**
 * Best-effort sync of a local chat thread to the Coop API.
 * Failures are swallowed — local persistence remains the source of truth.
 */
export async function syncThreadToBackend(
  thread: ChatThreadRecord,
  options: SyncOptions
): Promise<void> {
  try {
    const token = await options.getToken();
    if (!token) {
      return;
    }

    const baseUrl = options.baseUrl.replace(/\/$/, "");
    assertCoopEndpoint(baseUrl);

    const ownerEmail = options.getOwnerEmail ? (await options.getOwnerEmail())?.trim() : undefined;

    const body = {
      title: thread.title,
      repoOwner: thread.repoContext?.owner,
      repoName: thread.repoContext?.repo,
      repoProvider: thread.repoContext?.provider,
      previewText: previewFromThread(thread),
      createdAt: new Date(thread.createdAt).toISOString(),
      updatedAt: new Date(thread.updatedAt).toISOString(),
      ...(ownerEmail ? { ownerEmail } : {}),
      messages: thread.messages.map((message, index) => ({
        id: messageId(thread.id, index, message),
        role: message.role,
        content: message.content,
        sortOrder: index,
        metadata: {
          timestamp: message.timestamp,
          links: message.links,
          attachments: message.attachments?.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType
          })),
          relatedArtifactId: message.relatedArtifactId
        }
      }))
    };

    const response = await fetch(`${baseUrl}/v1/threads/${encodeURIComponent(thread.id)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      console.warn(`[coop] thread sync failed (${response.status}) for ${thread.id}`);
    }
  } catch (error) {
    console.warn("[coop] thread sync error:", error);
  }
}

/** Backfill local thread history to the API (skips empty threads). */
export async function syncAllThreadsToBackend(
  threads: ChatThreadRecord[],
  options: SyncOptions
): Promise<void> {
  const token = await options.getToken();
  if (!token) {
    return;
  }
  for (const thread of threads) {
    if (thread.messageCount <= 0 && thread.messages.length === 0) {
      continue;
    }
    await syncThreadToBackend(thread, options);
  }
}
