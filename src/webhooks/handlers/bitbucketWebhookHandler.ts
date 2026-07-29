import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookMonitor } from "../webhookMonitor";
import type {
  ChangedFile,
  CommitSummary,
  NormalizedWebhookEvent,
  PullRequestMetadata,
  RepositoryRef,
  WebhookHandlerResult,
  WebhookUpdateQueue,
  WebhookVerificationResult
} from "../types";

export type BitbucketWebhookRequest = {
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  body: unknown;
};

export type BitbucketWebhookHandlerOptions = {
  secret?: string;
  monitor: WebhookMonitor;
  queue: WebhookUpdateQueue;
};

/**
 * Bitbucket Cloud webhook handler.
 * Verify via X-Hub-Signature (HMAC SHA256) when BITBUCKET_WEBHOOK_SECRET is set.
 */
export class BitbucketWebhookHandler {
  public constructor(private readonly options: BitbucketWebhookHandlerOptions) {}

  public async handle(request: BitbucketWebhookRequest): Promise<WebhookHandlerResult> {
    const deliveryId =
      request.headers["x-request-uuid"] ??
      request.headers["x-hook-uuid"] ??
      stableDeliveryId(request.rawBody);
    const eventName = request.headers["x-event-key"] ?? "unknown";

    if (this.options.monitor.isDisabled("bitbucket")) {
      return this.finish(deliveryId, eventName, "failed", 503, "bitbucket webhook disabled");
    }

    const verification = verifyBitbucketSignature(
      request.headers["x-hub-signature"],
      request.rawBody,
      this.options.secret
    );
    if (!verification.ok) {
      this.options.monitor.recordVerificationFailure("bitbucket", deliveryId, eventName, verification);
      return { accepted: false, duplicate: false, statusCode: 401, message: verification.reason ?? "invalid signature" };
    }

    if (this.options.monitor.isDuplicate("bitbucket", deliveryId)) {
      return this.finish(deliveryId, eventName, "duplicate", 202, "duplicate delivery ignored", true);
    }

    const event = normalizeBitbucketEvent(eventName, deliveryId, request.body);
    if (!event) {
      return this.finish(deliveryId, eventName, "accepted", 202, `ignored unsupported bitbucket event: ${eventName}`);
    }

    await this.options.queue.enqueue(event);
    return this.finish(deliveryId, eventName, "accepted", 202, "bitbucket webhook accepted", false, event);
  }

  private finish(
    deliveryId: string,
    eventType: string,
    status: "accepted" | "failed" | "duplicate" | "rejected",
    statusCode: number,
    message: string,
    duplicate = false,
    event?: NormalizedWebhookEvent
  ): WebhookHandlerResult {
    this.options.monitor.record({
      provider: "bitbucket",
      deliveryId,
      eventType,
      status,
      statusCode,
      receivedAt: new Date(),
      reason: message
    });
    return { accepted: status === "accepted", duplicate, statusCode, message, event };
  }
}

export function verifyBitbucketSignature(
  header: string | undefined,
  rawBody: Buffer,
  secret: string | undefined
): WebhookVerificationResult {
  if (!secret) {
    return { ok: true };
  }
  if (!header) {
    return { ok: false, reason: "missing X-Hub-Signature" };
  }
  const provided = header.replace(/^sha256=/i, "").trim();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "signature mismatch" };
    }
  } catch {
    return { ok: false, reason: "invalid signature encoding" };
  }
  return { ok: true };
}

function normalizeBitbucketEvent(
  eventName: string,
  deliveryId: string,
  payload: unknown
): NormalizedWebhookEvent | undefined {
  const body = asRecord(payload);
  const repository = bitbucketRepo(body);
  if (!repository) {
    return undefined;
  }
  const receivedAt = new Date();

  if (eventName === "repo:push") {
    return {
      provider: "bitbucket",
      deliveryId,
      receivedAt,
      eventType: "push",
      repository,
      changedFiles: bitbucketPushFiles(body),
      commits: bitbucketPushCommits(body)
    };
  }

  if (eventName.startsWith("pullrequest:")) {
    return {
      provider: "bitbucket",
      deliveryId,
      receivedAt,
      eventType: "pull_request",
      repository,
      pullRequest: bitbucketPullRequest(asRecord(body.pullrequest)),
      changedFiles: []
    };
  }

  return undefined;
}

function bitbucketRepo(body: Record<string, unknown>): RepositoryRef | undefined {
  const repo = asRecord(body.repository);
  const fullName = stringValue(repo.full_name);
  if (!fullName?.includes("/")) {
    return undefined;
  }
  const [owner, name] = fullName.split("/", 2);
  if (!owner || !name) {
    return undefined;
  }
  return {
    provider: "bitbucket",
    repoId: `bitbucket:${owner}/${name}`,
    owner,
    repo: name,
    defaultBranch: stringValue(asRecord(repo.mainbranch).name)
  };
}

function bitbucketPushFiles(body: Record<string, unknown>): ChangedFile[] {
  const files = new Map<string, ChangedFile>();
  for (const changeRaw of arrayValue(asRecord(body.push).changes)) {
    const change = asRecord(changeRaw);
    for (const commitRaw of arrayValue(change.commits)) {
      const commit = asRecord(commitRaw);
      const author =
        stringValue(asRecord(asRecord(commit.author).user).display_name) ??
        stringValue(asRecord(commit.author).raw);
      const timestamp = dateValue(commit.date);
      // Bitbucket push payloads rarely include per-file lists; record commit presence via empty set.
      void author;
      void timestamp;
    }
    const newTarget = asRecord(change.new);
    const oldTarget = asRecord(change.old);
    const name = stringValue(newTarget.name) ?? stringValue(oldTarget.name);
    if (name) {
      files.set(name, {
        path: name,
        status: change.closed === true ? "removed" : "modified"
      });
    }
  }
  return [...files.values()];
}

function bitbucketPushCommits(body: Record<string, unknown>): CommitSummary[] {
  const commits: CommitSummary[] = [];
  for (const changeRaw of arrayValue(asRecord(body.push).changes)) {
    for (const commitRaw of arrayValue(asRecord(changeRaw).commits)) {
      commits.push(bitbucketCommit(commitRaw));
    }
  }
  return commits;
}

function bitbucketCommit(raw: unknown): CommitSummary {
  const commit = asRecord(raw);
  return {
    sha: stringValue(commit.hash) ?? "unknown",
    message: stringValue(commit.message) ?? "",
    author:
      stringValue(asRecord(asRecord(commit.author).user).display_name) ??
      stringValue(asRecord(commit.author).raw) ??
      "unknown",
    date: dateValue(commit.date) ?? new Date(),
    files: []
  };
}

function bitbucketPullRequest(raw: Record<string, unknown>): PullRequestMetadata {
  return {
    id: String(raw.id ?? ""),
    number: Number(raw.id) || 0,
    title: stringValue(raw.title) ?? "",
    state: stringValue(raw.state) ?? "OPEN",
    author: stringValue(asRecord(raw.author).display_name),
    sourceBranch: stringValue(asRecord(asRecord(raw.source).branch).name),
    targetBranch: stringValue(asRecord(asRecord(raw.destination).branch).name),
    updatedAt: dateValue(raw.updated_on) ?? new Date(),
    linkedIssues: []
  };
}

function stableDeliveryId(rawBody: Buffer): string {
  return createHmac("sha256", "coop-ai-bitbucket-delivery").update(rawBody).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dateValue(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
