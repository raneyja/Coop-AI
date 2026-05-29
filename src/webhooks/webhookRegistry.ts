import type { ProviderWebhookConfig } from "../config/webhookConfig";
import type { RepositoryRef, WebhookProvider } from "./types";
import { WebhookMonitor } from "./webhookMonitor";

export type WebhookRegistration = {
  id: string;
  provider: Exclude<WebhookProvider, "slack">;
  repoId: string;
  endpoint: string;
  events: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastDeliveryAt?: Date;
  failureCount: number;
};

export type ProviderWebhookClient = {
  registerWebhook(repo: RepositoryRef, config: ProviderWebhookConfig): Promise<{ id: string }>;
  unregisterWebhook(repo: RepositoryRef, registrationId: string): Promise<void>;
  redeliverWebhook?(registrationId: string, deliveryId: string): Promise<void>;
};

export type WebhookRegistryOptions = {
  github?: ProviderWebhookClient;
  gitlab?: ProviderWebhookClient;
  monitor: WebhookMonitor;
  retryLimit?: number;
};

export class WebhookRegistry {
  private readonly registrations = new Map<string, WebhookRegistration>();
  private readonly retryLimit: number;

  public constructor(private readonly options: WebhookRegistryOptions) {
    this.retryLimit = options.retryLimit ?? 3;
  }

  public async connectRepository(repo: RepositoryRef, config: ProviderWebhookConfig): Promise<WebhookRegistration> {
    const client = this.clientFor(repo.provider);
    if (!client) {
      throw new Error(`No webhook client configured for ${repo.provider}.`);
    }
    const response = await client.registerWebhook(repo, config);
    const now = new Date();
    const registration: WebhookRegistration = {
      id: response.id,
      provider: repo.provider,
      repoId: repo.repoId,
      endpoint: config.endpoint,
      events: [...config.events],
      active: true,
      createdAt: now,
      updatedAt: now,
      failureCount: 0
    };
    this.registrations.set(this.key(repo.provider, repo.repoId), registration);
    return this.clone(registration);
  }

  public async disconnectRepository(repo: RepositoryRef): Promise<boolean> {
    const key = this.key(repo.provider, repo.repoId);
    const registration = this.registrations.get(key);
    if (!registration) {
      return false;
    }
    const client = this.clientFor(repo.provider);
    if (client) {
      await client.unregisterWebhook(repo, registration.id);
    }
    this.registrations.delete(key);
    return true;
  }

  public recordDelivery(repoId: string, provider: Exclude<WebhookProvider, "slack">, ok: boolean): void {
    const registration = this.registrations.get(this.key(provider, repoId));
    if (!registration) {
      return;
    }
    registration.lastDeliveryAt = new Date();
    registration.updatedAt = new Date();
    registration.failureCount = ok ? 0 : registration.failureCount + 1;
    if (registration.failureCount > this.retryLimit) {
      registration.active = false;
    }
  }

  public async retryDelivery(
    provider: Exclude<WebhookProvider, "slack">,
    repoId: string,
    deliveryId: string
  ): Promise<boolean> {
    const registration = this.registrations.get(this.key(provider, repoId));
    const client = this.clientFor(provider);
    if (!registration || !client?.redeliverWebhook) {
      return false;
    }
    await client.redeliverWebhook(registration.id, deliveryId);
    return true;
  }

  public health(): Array<WebhookRegistration & { recommendation?: string }> {
    return [...this.registrations.values()].map((registration) => ({
      ...this.clone(registration),
      recommendation: this.recommendation(registration)
    }));
  }

  public get(provider: Exclude<WebhookProvider, "slack">, repoId: string): WebhookRegistration | undefined {
    const registration = this.registrations.get(this.key(provider, repoId));
    return registration ? this.clone(registration) : undefined;
  }

  public list(): WebhookRegistration[] {
    return [...this.registrations.values()].map((registration) => this.clone(registration));
  }

  private clientFor(provider: Exclude<WebhookProvider, "slack">): ProviderWebhookClient | undefined {
    return provider === "github" ? this.options.github : this.options.gitlab;
  }

  private recommendation(registration: WebhookRegistration): string | undefined {
    if (!registration.active) {
      return "Webhook is inactive after repeated delivery failures; re-register the repository webhook.";
    }
    const providerHealth = this.options.monitor.getHealth(registration.provider);
    if (providerHealth.recommendation) {
      return providerHealth.recommendation;
    }
    if (!registration.lastDeliveryAt) {
      return "Webhook is registered but has not delivered events yet.";
    }
    return undefined;
  }

  private key(provider: Exclude<WebhookProvider, "slack">, repoId: string): string {
    return `${provider}:${repoId}`;
  }

  private clone(registration: WebhookRegistration): WebhookRegistration {
    return {
      ...registration,
      events: [...registration.events],
      createdAt: new Date(registration.createdAt),
      updatedAt: new Date(registration.updatedAt),
      lastDeliveryAt: registration.lastDeliveryAt ? new Date(registration.lastDeliveryAt) : undefined
    };
  }
}

export class PlaceholderWebhookClient implements ProviderWebhookClient {
  public async registerWebhook(repo: RepositoryRef, config: ProviderWebhookConfig): Promise<{ id: string }> {
    return {
      id: `${repo.provider}:${repo.owner}/${repo.repo}:${Buffer.from(config.endpoint).toString("base64url").slice(0, 12)}`
    };
  }

  public async unregisterWebhook(_repo: RepositoryRef, _registrationId: string): Promise<void> {
    return;
  }

  public async redeliverWebhook(_registrationId: string, _deliveryId: string): Promise<void> {
    return;
  }
}
