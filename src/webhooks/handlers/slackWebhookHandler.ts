import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookMonitor } from "../webhookMonitor";
import type {
  NormalizedWebhookEvent,
  SlackDecisionMetadata,
  WebhookHandlerResult,
  WebhookUpdateQueue,
  WebhookVerificationResult
} from "../types";

export type SlackWebhookRequest = {
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  body: unknown;
};

export type SlackWebhookHandlerOptions = {
  signingSecret?: string;
  monitor: WebhookMonitor;
  queue: WebhookUpdateQueue;
};

const DECISION_KEYWORDS = [
  "decision",
  "decided",
  "approved",
  "blocked",
  "rollback",
  "ship",
  "launch",
  "deprecate",
  "incident",
  "hotfix"
];

export class SlackWebhookHandler {
  public constructor(private readonly options: SlackWebhookHandlerOptions) {}

  public async handle(request: SlackWebhookRequest): Promise<WebhookHandlerResult> {
    const body = asRecord(request.body);
    const event = asRecord(body.event);
    const deliveryId = stringValue(body.event_id) ?? `${stringValue(event.client_msg_id) ?? "slack"}:${stringValue(event.ts) ?? Date.now()}`;
    const eventType = stringValue(event.type) ?? stringValue(body.type) ?? "unknown";

    if (this.options.monitor.isDisabled("slack")) {
      return this.finish(deliveryId, eventType, "failed", 503, "slack webhook disabled");
    }

    const verification = verifySlackSignature(
      request.rawBody,
      request.headers["x-slack-request-timestamp"],
      request.headers["x-slack-signature"],
      this.options.signingSecret
    );
    if (!verification.ok) {
      this.options.monitor.recordVerificationFailure("slack", deliveryId, eventType, verification);
      return { accepted: false, duplicate: false, statusCode: 401, message: verification.reason ?? "invalid signature" };
    }

    if (this.options.monitor.isDuplicate("slack", deliveryId)) {
      return this.finish(deliveryId, eventType, "duplicate", 202, "duplicate delivery ignored", true);
    }

    const normalized = normalizeSlackEvent(deliveryId, request.body);
    if (!normalized) {
      return this.finish(deliveryId, eventType, "accepted", 202, `ignored unsupported slack event: ${eventType}`);
    }

    await this.options.queue.enqueue(normalized);
    return this.finish(deliveryId, eventType, "accepted", 202, "slack webhook accepted", false, normalized);
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
      provider: "slack",
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

export function verifySlackSignature(
  rawBody: Buffer,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  signingSecret: string | undefined
): WebhookVerificationResult {
  if (!signingSecret) {
    return { ok: false, reason: "missing Slack signing secret" };
  }
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "missing Slack signature headers" };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "invalid Slack timestamp" };
  }
  if (Math.abs(Date.now() / 1000 - timestamp) > 5 * 60) {
    return { ok: false, reason: "stale Slack request timestamp" };
  }
  const base = `v0:${timestampHeader}:${rawBody.toString("utf8")}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  if (signatureHeader.length !== expected.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}

export function normalizeSlackEvent(
  deliveryId: string,
  payload: unknown
): NormalizedWebhookEvent | undefined {
  const body = asRecord(payload);
  const event = asRecord(body.event);
  const eventType = stringValue(event.type);
  const subtype = stringValue(event.subtype);

  if (eventType === "message" && subtype && subtype !== "bot_message") {
    return undefined;
  }

  if (eventType === "message" || eventType === "app_mention") {
    const decision = slackDecision(body, event, "message");
    return decision
      ? {
          provider: "slack",
          deliveryId,
          receivedAt: new Date(),
          eventType,
          decision
        }
      : undefined;
  }

  if (eventType === "reaction_added" || eventType === "reaction_removed") {
    const decision = slackDecision(body, event, "reaction");
    return decision
      ? {
          provider: "slack",
          deliveryId,
          receivedAt: new Date(),
          eventType: "reaction",
          decision
        }
      : undefined;
  }

  return undefined;
}

function slackDecision(
  body: Record<string, unknown>,
  event: Record<string, unknown>,
  source: "message" | "reaction"
): SlackDecisionMetadata | undefined {
  const text = stringValue(event.text) ?? "";
  const linkedRefs = extractCodeRefs(text);
  const keywords = extractDecisionKeywords(text);
  const reaction = stringValue(event.reaction);
  if (linkedRefs.length === 0 && keywords.length === 0 && !reaction) {
    return undefined;
  }
  return {
    id: stringValue(body.event_id) ?? `${stringValue(event.channel)}:${stringValue(event.ts) ?? Date.now()}`,
    teamId: stringValue(body.team_id),
    channelId: stringValue(event.channel) ?? stringValue(asRecord(event.item).channel),
    userId: stringValue(event.user),
    timestamp: slackTimestamp(stringValue(event.ts) ?? stringValue(asRecord(event.item).ts)),
    decisionKeywords: keywords,
    linkedRefs,
    reaction: source === "reaction" ? reaction : undefined
  };
}

function extractDecisionKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return DECISION_KEYWORDS.filter((keyword) => lower.includes(keyword));
}

function extractCodeRefs(text: string): SlackDecisionMetadata["linkedRefs"] {
  const refs: SlackDecisionMetadata["linkedRefs"] = [];
  for (const match of text.matchAll(/https:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/(?:pull|issues)\/(\d+)/g)) {
    refs.push({ provider: "github", owner: match[1], repo: match[2], number: Number(match[3]), url: match[0] });
  }
  for (const match of text.matchAll(/https:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/commit\/([a-f0-9]{7,40})/gi)) {
    refs.push({ provider: "github", owner: match[1], repo: match[2], sha: match[3], url: match[0] });
  }
  for (const match of text.matchAll(/https:\/\/gitlab\.com\/([^/\s]+)\/([^/\s]+)\/-\/(?:merge_requests|issues)\/(\d+)/g)) {
    refs.push({ provider: "gitlab", owner: match[1], repo: match[2], number: Number(match[3]), url: match[0] });
  }
  for (const match of text.matchAll(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/g)) {
    refs.push({ provider: "github", owner: match[1], repo: match[2], number: Number(match[3]) });
  }
  return refs;
}

function slackTimestamp(value: string | undefined): Date {
  if (!value) {
    return new Date();
  }
  const seconds = Number(value.split(".")[0]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
