import { createHmac, timingSafeEqual } from "node:crypto";
import type { GitHubAppService } from "../../server/githubAppService";
import type { OrgStore } from "../../server/orgStore";
import type { EstateSyncService } from "../../server/estateSyncService";
import { WebhookMonitor } from "../webhookMonitor";
import type {
  ChangedFile,
  CommitSummary,
  IssueMetadata,
  NormalizedWebhookEvent,
  PullRequestMetadata,
  RepositoryRef,
  ReviewMetadata,
  WebhookHandlerResult,
  WebhookUpdateQueue,
  WebhookVerificationResult
} from "../types";

export type GitHubWebhookRequest = {
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  body: unknown;
};

export type GitHubWebhookHandlerOptions = {
  secret?: string;
  monitor: WebhookMonitor;
  queue: WebhookUpdateQueue;
  orgStore?: OrgStore;
  githubApp?: GitHubAppService;
  estateSync?: EstateSyncService;
};

export class GitHubWebhookHandler {
  public constructor(private readonly options: GitHubWebhookHandlerOptions) {}

  public async handle(request: GitHubWebhookRequest): Promise<WebhookHandlerResult> {
    const deliveryId = request.headers["x-github-delivery"] ?? stableDeliveryId(request.rawBody);
    const eventName = request.headers["x-github-event"] ?? "unknown";

    if (this.options.monitor.isDisabled("github")) {
      return this.finish(deliveryId, eventName, "failed", 503, "github webhook disabled");
    }

    const verification = verifyGitHubSignature(
      request.rawBody,
      request.headers["x-hub-signature-256"],
      this.options.secret
    );
    if (!verification.ok) {
      this.options.monitor.recordVerificationFailure("github", deliveryId, eventName, verification);
      return { accepted: false, duplicate: false, statusCode: 401, message: verification.reason ?? "invalid signature" };
    }

    if (this.options.monitor.isDuplicate("github", deliveryId)) {
      return this.finish(deliveryId, eventName, "duplicate", 202, "duplicate delivery ignored", true);
    }

    if (eventName === "installation") {
      return this.handleInstallation(deliveryId, request.body);
    }

    if (eventName === "installation_repositories") {
      return this.handleInstallationRepositories(deliveryId, request.body);
    }

    const event = normalizeGitHubEvent(eventName, deliveryId, request.body);
    if (!event) {
      return this.finish(deliveryId, eventName, "accepted", 202, `ignored unsupported github event: ${eventName}`);
    }

    await this.options.queue.enqueue(event);
    return this.finish(deliveryId, eventName, "accepted", 202, "github webhook accepted", false, event);
  }

  private async handleInstallation(
    deliveryId: string,
    payload: unknown
  ): Promise<WebhookHandlerResult> {
    const body = asRecord(payload);
    const action = stringValue(body.action);
    const installation = asRecord(body.installation);
    const installationId = numberValue(installation.id);

    if (!installationId) {
      return this.finish(deliveryId, "installation", "accepted", 202, "ignored installation without id");
    }

    if (action === "deleted") {
      const orgId = await this.options.orgStore?.findOrgIdByInstallation(installationId, "github");
      if (orgId) {
        await this.options.orgStore?.deleteCodeHostInstallation(orgId, "github");
      }
      return this.finish(
        deliveryId,
        "installation",
        "accepted",
        202,
        `installation deleted: ${installationId}`
      );
    }

    if (action === "created" || action === "new_permissions_accepted") {
      await this.persistInstallationToken(installationId, body);
      await this.maybeRunEstateSync(installationId);
      return this.finish(
        deliveryId,
        "installation",
        "accepted",
        202,
        `installation ${action}: ${installationId}`
      );
    }

    return this.finish(
      deliveryId,
      "installation",
      "accepted",
      202,
      `ignored installation action: ${action ?? "unknown"}`
    );
  }

  private async persistInstallationToken(
    installationId: number,
    body: Record<string, unknown>
  ): Promise<void> {
    if (!this.options.orgStore || !this.options.githubApp) {
      return;
    }
    const orgId = await this.options.orgStore.findOrgIdByInstallation(installationId, "github");
    if (!orgId) {
      return;
    }
    try {
      const token = await this.options.githubApp.createInstallationAccessToken(installationId);
      await this.options.orgStore.upsertCodeHostInstallation(
        orgId,
        "github",
        installationId,
        token.token,
        token.expiresAt
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[github] failed to refresh installation token for ${installationId}: ${message}`);
    }
  }

  private async maybeRunEstateSync(installationId: number): Promise<void> {
    if (!this.options.orgStore || !this.options.estateSync) {
      return;
    }
    const orgId = await this.options.orgStore.findOrgIdByInstallation(installationId, "github");
    if (!orgId) {
      return;
    }
    const org = await this.options.orgStore.getOrganization(orgId);
    if (org?.plan !== "enterprise") {
      return;
    }
    try {
      await this.options.estateSync.syncInstallation(orgId, installationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[github] estate sync failed for org=${orgId}: ${message}`);
    }
  }

  private async handleInstallationRepositories(
    deliveryId: string,
    payload: unknown
  ): Promise<WebhookHandlerResult> {
    const body = asRecord(payload);
    const action = stringValue(body.action);
    const installation = asRecord(body.installation);
    const installationId = numberValue(installation.id);
    if (installationId) {
      await this.persistInstallationToken(installationId, body);
    }

    if (action !== "added") {
      return this.finish(
        deliveryId,
        "installation_repositories",
        "accepted",
        202,
        `installation_repositories action: ${action ?? "unknown"}`
      );
    }

    if (installationId) {
      await this.maybeRunEstateSync(installationId);
    }

    const receivedAt = new Date();
    const repos = arrayValue(body.repositories_added);
    let enqueued = 0;
    for (const repoRaw of repos) {
      const repository = githubRepo(repoRaw);
      if (!repository) {
        continue;
      }
      const event: NormalizedWebhookEvent = {
        provider: "github",
        deliveryId,
        receivedAt,
        eventType: "repository",
        repository,
        repositoryAction: "created"
      };
      await this.options.queue.enqueue(event);
      enqueued += 1;
    }

    return this.finish(
      deliveryId,
      "installation_repositories",
      "accepted",
      202,
      `installation_repositories: enqueued ${enqueued} repository onboarding event(s)`
    );
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
      provider: "github",
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

export function verifyGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string | undefined
): WebhookVerificationResult {
  if (!secret) {
    return { ok: false, reason: "missing GitHub webhook secret" };
  }
  if (!signatureHeader?.startsWith("sha256=")) {
    return { ok: false, reason: "missing X-Hub-Signature-256" };
  }
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  if (signatureHeader.length !== expected.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  return timingSafeEqual(actualBuffer, expectedBuffer)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}

export function normalizeGitHubEvent(
  eventName: string,
  deliveryId: string,
  payload: unknown
): NormalizedWebhookEvent | undefined {
  const body = asRecord(payload);
  const repository = githubRepo(body.repository);
  if (!repository) {
    return undefined;
  }
  const receivedAt = new Date();

  switch (eventName) {
    case "push":
      return {
        provider: "github",
        deliveryId,
        receivedAt,
        eventType: "push",
        repository,
        ref: stringValue(body.ref),
        changedFiles: githubPushFiles(body),
        commits: arrayValue(body.commits).map(githubCommit)
      };
    case "pull_request":
      return {
        provider: "github",
        deliveryId,
        receivedAt,
        eventType: "pull_request",
        repository,
        pullRequest: githubPullRequest(body.pull_request),
        changedFiles: []
      };
    case "pull_request_review":
      return {
        provider: "github",
        deliveryId,
        receivedAt,
        eventType: "pull_request_review",
        repository,
        review: githubReview(body)
      };
    case "issues":
      return {
        provider: "github",
        deliveryId,
        receivedAt,
        eventType: "issues",
        repository,
        issue: githubIssue(body.issue)
      };
    case "repository":
      return {
        provider: "github",
        deliveryId,
        receivedAt,
        eventType: "repository",
        repository,
        repositoryAction: stringValue(body.action)
      };
    default:
      return undefined;
  }
}

function githubRepo(raw: unknown): RepositoryRef | undefined {
  const repo = asRecord(raw);
  const fullName = stringValue(repo.full_name);
  const owner = stringValue(asRecord(repo.owner).login) ?? fullName?.split("/")[0];
  const name = stringValue(repo.name) ?? fullName?.split("/")[1];
  if (!owner || !name) {
    return undefined;
  }
  return {
    provider: "github",
    repoId: `github:${owner}/${name}`,
    owner,
    repo: name,
    defaultBranch: stringValue(repo.default_branch)
  };
}

function githubPushFiles(body: Record<string, unknown>): ChangedFile[] {
  const files = new Map<string, ChangedFile>();
  for (const commitRaw of arrayValue(body.commits)) {
    const commit = asRecord(commitRaw);
    const author = stringValue(asRecord(commit.author).username) ?? stringValue(asRecord(commit.author).name);
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

function githubCommit(raw: unknown): CommitSummary {
  const commit = asRecord(raw);
  const files = [...stringArray(commit.added), ...stringArray(commit.modified), ...stringArray(commit.removed)];
  return {
    sha: stringValue(commit.id) ?? stringValue(commit.sha) ?? "",
    message: stringValue(commit.message) ?? "",
    author: stringValue(asRecord(commit.author).username) ?? stringValue(asRecord(commit.author).name) ?? "unknown",
    date: dateValue(commit.timestamp) ?? new Date(),
    files: [...new Set(files)]
  };
}

function githubPullRequest(raw: unknown): PullRequestMetadata {
  const pr = asRecord(raw);
  return {
    id: String(numberValue(pr.id) ?? stringValue(pr.node_id) ?? stringValue(pr.url) ?? ""),
    number: numberValue(pr.number) ?? 0,
    title: stringValue(pr.title) ?? "",
    state: stringValue(pr.state) ?? "unknown",
    author: stringValue(asRecord(pr.user).login),
    sourceBranch: stringValue(asRecord(pr.head).ref),
    targetBranch: stringValue(asRecord(pr.base).ref),
    updatedAt: dateValue(pr.updated_at) ?? new Date(),
    linkedIssues: extractIssueRefs(stringValue(pr.title), stringValue(pr.body))
  };
}

function githubReview(body: Record<string, unknown>): ReviewMetadata {
  const review = asRecord(body.review);
  const pr = asRecord(body.pull_request);
  return {
    id: String(numberValue(review.id) ?? stringValue(review.node_id) ?? ""),
    pullRequestNumber: numberValue(pr.number) ?? 0,
    author: stringValue(asRecord(review.user).login),
    state: stringValue(review.state),
    submittedAt: dateValue(review.submitted_at) ?? new Date(),
    comments: arrayValue(body.comments).map((commentRaw) => {
      const comment = asRecord(commentRaw);
      return {
        id: String(numberValue(comment.id) ?? stringValue(comment.node_id) ?? ""),
        path: stringValue(comment.path),
        line: numberValue(comment.line),
        createdAt: dateValue(comment.created_at) ?? new Date()
      };
    })
  };
}

function githubIssue(raw: unknown): IssueMetadata {
  const issue = asRecord(raw);
  return {
    id: String(numberValue(issue.id) ?? stringValue(issue.node_id) ?? ""),
    number: numberValue(issue.number) ?? 0,
    title: stringValue(issue.title) ?? "",
    state: stringValue(issue.state) ?? "unknown",
    author: stringValue(asRecord(issue.user).login),
    updatedAt: dateValue(issue.updated_at) ?? new Date(),
    linkedFiles: extractFileRefs(stringValue(issue.body))
  };
}

function stableDeliveryId(rawBody: Buffer): string {
  return createHmac("sha256", "coop-ai-delivery").update(rawBody).digest("hex");
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
