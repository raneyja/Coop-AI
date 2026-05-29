import type { WebhookProvider, WebhookVerificationResult } from "./types";

export type WebhookDeliveryStatus = "accepted" | "failed" | "duplicate" | "rejected";

export type WebhookDeliveryRecord = {
  provider: WebhookProvider;
  deliveryId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  receivedAt: Date;
  statusCode: number;
  reason?: string;
};

export type WebhookHealth = {
  provider: WebhookProvider;
  totalDeliveries: number;
  failures: number;
  duplicates: number;
  rejected: number;
  successRate: number;
  failureRate: number;
  lastDeliveryAt?: Date;
  disabled: boolean;
  recommendation?: string;
};

export type WebhookMonitorOptions = {
  dedupeWindowMs?: number;
  maxDeliveryRecords?: number;
  warnFailureRate?: number;
  disableFailureRate?: number;
  minDeliveriesForDisable?: number;
};

const DEFAULT_DEDUPE_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_RECORDS = 1000;
const DEFAULT_WARN_FAILURE_RATE = 0.1;
const DEFAULT_DISABLE_FAILURE_RATE = 0.25;
const DEFAULT_MIN_DELIVERIES_FOR_DISABLE = 20;

export class WebhookMonitor {
  private readonly deliveries: WebhookDeliveryRecord[] = [];
  private readonly deliveryIds = new Map<string, number>();
  private readonly disabledProviders = new Set<WebhookProvider>();
  private readonly dedupeWindowMs: number;
  private readonly maxDeliveryRecords: number;
  private readonly warnFailureRate: number;
  private readonly disableFailureRate: number;
  private readonly minDeliveriesForDisable: number;

  public constructor(options: WebhookMonitorOptions = {}) {
    this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.maxDeliveryRecords = options.maxDeliveryRecords ?? DEFAULT_MAX_RECORDS;
    this.warnFailureRate = options.warnFailureRate ?? DEFAULT_WARN_FAILURE_RATE;
    this.disableFailureRate = options.disableFailureRate ?? DEFAULT_DISABLE_FAILURE_RATE;
    this.minDeliveriesForDisable = options.minDeliveriesForDisable ?? DEFAULT_MIN_DELIVERIES_FOR_DISABLE;
  }

  public isDuplicate(provider: WebhookProvider, deliveryId: string): boolean {
    this.pruneDeliveryIds();
    const key = this.deliveryKey(provider, deliveryId);
    if (this.deliveryIds.has(key)) {
      return true;
    }
    this.deliveryIds.set(key, Date.now() + this.dedupeWindowMs);
    return false;
  }

  public isDisabled(provider: WebhookProvider): boolean {
    return this.disabledProviders.has(provider);
  }

  public enable(provider: WebhookProvider): void {
    this.disabledProviders.delete(provider);
  }

  public record(record: WebhookDeliveryRecord): void {
    this.deliveries.push({ ...record, receivedAt: new Date(record.receivedAt) });
    if (this.deliveries.length > this.maxDeliveryRecords) {
      this.deliveries.splice(0, this.deliveries.length - this.maxDeliveryRecords);
    }

    const health = this.getHealth(record.provider);
    if (
      health.totalDeliveries >= this.minDeliveriesForDisable &&
      health.failureRate >= this.disableFailureRate
    ) {
      this.disabledProviders.add(record.provider);
    }
  }

  public recordVerificationFailure(
    provider: WebhookProvider,
    deliveryId: string,
    eventType: string,
    verification: WebhookVerificationResult
  ): void {
    this.record({
      provider,
      deliveryId,
      eventType,
      status: "rejected",
      receivedAt: new Date(),
      statusCode: 401,
      reason: verification.reason ?? "signature verification failed"
    });
  }

  public getHealth(provider?: WebhookProvider): WebhookHealth {
    const records = this.deliveries.filter((record) => !provider || record.provider === provider);
    const total = records.length;
    const failures = records.filter((record) => record.status === "failed").length;
    const rejected = records.filter((record) => record.status === "rejected").length;
    const duplicates = records.filter((record) => record.status === "duplicate").length;
    const successful = records.filter((record) => record.status === "accepted").length;
    const failureRate = total === 0 ? 0 : (failures + rejected) / total;
    const targetProvider = provider ?? "github";
    const disabled = provider ? this.disabledProviders.has(provider) : this.disabledProviders.size > 0;
    return {
      provider: targetProvider,
      totalDeliveries: total,
      failures,
      duplicates,
      rejected,
      successRate: total === 0 ? 1 : successful / total,
      failureRate,
      lastDeliveryAt: records.at(-1)?.receivedAt,
      disabled,
      recommendation: this.recommendation(total, failureRate, disabled)
    };
  }

  public getAllHealth(): WebhookHealth[] {
    return (["github", "gitlab", "slack"] as const).map((provider) => this.getHealth(provider));
  }

  public recentDeliveries(limit = 100): WebhookDeliveryRecord[] {
    return this.deliveries.slice(-limit).map((record) => ({ ...record, receivedAt: new Date(record.receivedAt) }));
  }

  private recommendation(total: number, failureRate: number, disabled: boolean): string | undefined {
    if (disabled) {
      return "Webhook has been disabled due to repeated failures; re-register and verify provider secrets.";
    }
    if (total > 0 && failureRate > this.warnFailureRate) {
      return "Webhook failure rate is elevated; check signature secrets, endpoint availability, and delivery logs.";
    }
    return undefined;
  }

  private pruneDeliveryIds(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.deliveryIds) {
      if (now > expiresAt) {
        this.deliveryIds.delete(key);
      }
    }
  }

  private deliveryKey(provider: WebhookProvider, deliveryId: string): string {
    return `${provider}:${deliveryId}`;
  }
}
