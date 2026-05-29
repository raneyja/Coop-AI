import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookMonitor } from "../webhookMonitor";
import type {
  ChangedFile,
  CommitSummary,
  IssueMetadata,
  NormalizedWebhookEvent,
  PullRequestMetadata,
  RepositoryRef,
  WebhookHandlerResult,
  WebhookUpdateQueue,
  WebhookVerificationResult
} from "../types";

export type GitLabWebhookRequest = {
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  body: unknown;
};

export type GitLabWebhookHandlerOptions = {
  token?: string;
  monitor: WebhookMonitor;
  queue: WebhookUpdateQueue;
};

export class GitLabWebhookHandler {
  public constructor(private readonly options: GitLabWebhookHandlerOptions) {}

  public async handle(request: GitLabWebhookRequest): Promise<WebhookHandlerResult> {
    const deliveryId = request.headers["x-gitlab-event-uuid"] ?? stableDeliveryId(request.rawBody);
    const eventName = request.headers["x-gitlab-event"] ?? stringValue(asRecord(request.body).object_kind) ?? "unknown";

    if (this.options.monitor.isDisabled("gitlab")) {
      return this.finish(deliveryId, eventName, "failed", 503, "gitlab webhook disabled");
    }

    const verification = verifyGitLabToken(request.headers["x-gitlab-token"], this.options.token);
    if (!verification.ok) {
      this.options.monitor.recordVerificationFailure("gitlab", deliveryId, eventName, verification);
      return { accepted: false, duplicate: false, statusCode: 401, message: verification.reason ?? "invalid token" };
    }

    if (this.options.monitor.isDuplicate("gitlab", deliveryId)) {
      return this.finish(deliveryId, eventName, "duplicate", 202, "duplicate delivery ignored", true);
    }

    const event = normalizeGitLabEvent(eventName, deliveryId, request.body);
    if (!event) {
      return this.finish(deliveryId, eventName, "accepted", 202, `ignored unsupported gitlab event: ${eventName}`);
    }

    await this.options.queue.enqueue(event);
    return this.finish(deliveryId, eventName, "accepted", 202, "gitlab webhook accepted", false, event);
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
      provider: "gitlab",
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

export function verifyGitLabToken(
  header: string | undefined,
  token: string | undefined
): WebhookVerificationResult {
  if (!token) {
    return { ok: false, reason: "missing GitLab webhook token" };
  }
  if (!header) {
    return { ok: false, reason: "missing X-Gitlab-Token" };
  }
  const actual = Buffer.from(header);
  const expected = Buffer.from(token);
  if (actual.length !== expected.length) {
    return { ok: false, reason: "token length mismatch" };
  }
  return timingSafeEqual(actual, expected) ? { ok: true } : { ok: false, reason: "token mismatch" };
}

export function normalizeGitLabEvent(
  eventName: string,
  deliveryId: string,
  payload: unknown
): NormalizedWebhookEvent | undefined {
  const body = asRecord(payload);
  const objectKind = stringValue(body.object_kind) ?? eventName.toLowerCase();
  const repository = gitlabRepo(body);
  if (!repository) {
    return undefined;
  }
  const receivedAt = new Date();

  if (objectKind === "push" || eventName === "Push Hook") {
    return {
      provider: "gitlab",
      deliveryId,
      receivedAt,
      eventType: "push",
      repository,
      ref: stringValue(body.ref),
      changedFiles: gitlabPushFiles(body),
      commits: arrayValue(body.commits).map(gitlabCommit)
    };
  }

  if (objectKind === "merge_request") {
    return {
      provider: "gitlab",
      deliveryId,
      receivedAt,
      eventType: "merge_request",
      repository,
      pullRequest: gitlabMergeRequest(body.object_attributes),
      changedFiles: gitlabMergeRequestFiles(body)
    };
  }

  if (objectKind === "issue") {
    return {
      provider: "gitlab",
      deliveryId,
      receivedAt,
      eventType: "issue",
      repository,
      issue: gitlabIssue(body.object_attributes)
    };
  }

  if (objectKind === "wiki_page") {
    return {
      provider: "gitlab",
      deliveryId,
      receivedAt,
      eventType: "wiki",
      repository
    };
  }

  return undefined;
}

function gitlabRepo(body: Record<string, unknown>): RepositoryRef | undefined {
  const project = asRecord(body.project);
  const pathWithNamespace = stringValue(project.path_with_namespace) ?? stringValue(asRecord(body.repository).homepage)?.split("/").slice(-2).join("/");
  const [owner, repo] = pathWithNamespace?.split("/") ?? [];
  const name = stringValue(project.name) ?? repo;
  if (!owner || !name) {
    return undefined;
  }
  return {
    provider: "gitlab",
    repoId: `gitlab:${owner}/${name}`,
    owner,
    repo: name,
    defaultBranch: stringValue(project.default_branch)
  };
}

function gitlabPushFiles(body: Record<string, unknown>): ChangedFile[] {
  const files = new Map<string, ChangedFile>();
  for (const commitRaw of arrayValue(body.commits)) {
    const commit = asRecord(commitRaw);
    const author = stringValue(commit.author_name) ?? stringValue(asRecord(commit.author).name);
    const timestamp = dateValue(commit.timestamp);
    for (const path of stringArray(commit.added)) {
      files.set(path, { path, status: "added", lastAuthor: author, lastModified: timestamp });
    }
    for (const path of stringArray(commit.modified)) {
      files.set(path, { path, status: "modified", lastAuthor: author, lastModified: timestamp });
    }
    for (const path of stringArray(commit.removed)) {
      files.set(path, { path, status: "removed", lastAuthor: author, lastModified: timestamp });
    }
  }
  return [...files.values()];
}

function gitlabMergeRequestFiles(body: Record<string, unknown>): ChangedFile[] {
  return arrayValue(body.changes).map((changeRaw) => {
    const change = asRecord(changeRaw);
    const status: ChangedFile["status"] = change.deleted_file === true
      ? "removed"
      : change.new_file === true
        ? "added"
        : change.renamed_file === true
          ? "renamed"
          : "modified";
    return {
      path: stringValue(change.new_path) ?? stringValue(change.old_path) ?? "",
      previousPath: stringValue(change.old_path),
      status
    };
  }).filter((file) => file.path.length > 0);
}

function gitlabCommit(raw: unknown): CommitSummary {
  const commit = asRecord(raw);
  return {
    sha: stringValue(commit.id) ?? "",
    message: stringValue(commit.message) ?? "",
    author: stringValue(commit.author_name) ?? stringValue(asRecord(commit.author).name) ?? "unknown",
    date: dateValue(commit.timestamp) ?? new Date(),
    files: [...new Set([...stringArray(commit.added), ...stringArray(commit.modified), ...stringArray(commit.removed)])]
  };
}

function gitlabMergeRequest(raw: unknown): PullRequestMetadata {
  const mr = asRecord(raw);
  return {
    id: String(numberValue(mr.id) ?? numberValue(mr.iid) ?? ""),
    number: numberValue(mr.iid) ?? 0,
    title: stringValue(mr.title) ?? "",
    state: stringValue(mr.state) ?? "unknown",
    author: stringValue(asRecord(mr.author).username),
    sourceBranch: stringValue(mr.source_branch),
    targetBranch: stringValue(mr.target_branch),
    updatedAt: dateValue(mr.updated_at) ?? new Date(),
    linkedIssues: extractIssueRefs(stringValue(mr.title), stringValue(mr.description))
  };
}

function gitlabIssue(raw: unknown): IssueMetadata {
  const issue = asRecord(raw);
  return {
    id: String(numberValue(issue.id) ?? numberValue(issue.iid) ?? ""),
    number: numberValue(issue.iid) ?? 0,
    title: stringValue(issue.title) ?? "",
    state: stringValue(issue.state) ?? "unknown",
    author: stringValue(asRecord(issue.author).username),
    updatedAt: dateValue(issue.updated_at) ?? new Date(),
    linkedFiles: extractFileRefs(stringValue(issue.description))
  };
}

function stableDeliveryId(rawBody: Buffer): string {
  return createHmac("sha256", "coop-ai-gitlab-delivery").update(rawBody).digest("hex");
}

function extractIssueRefs(...texts: Array<string | undefined>): string[] {
  const refs = new Set<string>();
  for (const text of texts.filter(Boolean)) {
    for (const match of text!.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)|#(\d+)/gi)) {
      refs.add(match[1] ?? match[2]);
    }
  }
  return [...refs];
}

function extractFileRefs(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  const refs = new Set<string>();
  for (const match of text.matchAll(/`([^`\s]+\.[A-Za-z0-9]+)`/g)) {
    refs.add(match[1]);
  }
  return [...refs];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dateValue(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
