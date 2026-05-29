import { createHash } from "crypto";
import { sanitizeLlmRequestPayload, sanitizePlainText } from "./dataSanitization";
import {
  assertStandardInferenceEndpoint,
  buildProviderHeaders,
  getZeroRetentionConfig,
  LlmProvider,
  ZeroRetentionHeaders
} from "./zeroRetentionConfig";

export type ByokProvider = Extract<LlmProvider, "openai" | "anthropic" | "deepseek" | "gemini">;

export type KeyManagementSystem = "aws-kms" | "azure-keyvault" | "vault";

export type RotationSchedule = "monthly" | "quarterly" | "yearly";

export interface ByokConfig {
  customerId: string;
  provider: ByokProvider;
  apiKeyHash: string;
  encryptedKey: string;
  keyManagementSystem: KeyManagementSystem;
  rotationSchedule: RotationSchedule;
  createdAt: Date;
  updatedAt: Date;
  disabled?: boolean;
}

export type ByokRequest = {
  provider: ByokProvider;
  model: string;
  endpointUrl?: string;
  body: Record<string, unknown>;
  headers?: ZeroRetentionHeaders;
};

export type ByokAuditEvent = {
  customerId: string;
  provider: ByokProvider;
  model: string;
  requestId?: string;
  usedByok: true;
  timestamp: Date;
  status: "started" | "succeeded" | "failed";
  statusCode?: number;
  errorClass?: string;
};

export interface ByokConfigStore {
  getByokConfig(customerId: string, provider: ByokProvider): Promise<ByokConfig | undefined>;
  saveByokConfig(config: ByokConfig): Promise<void>;
  disableByokConfig(customerId: string, provider: ByokProvider): Promise<void>;
}

export interface CustomerKeyDecryptor {
  decryptKey(config: ByokConfig): Promise<string>;
}

export interface ByokAuditSink {
  write(event: ByokAuditEvent): Promise<void>;
}

export type ByokHandlerOptions = {
  store: ByokConfigStore;
  decryptor: CustomerKeyDecryptor;
  auditSink: ByokAuditSink;
  fetchImpl?: typeof fetch;
};

export class ByokHandler {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: ByokHandlerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async upsertConfig(
    config: Omit<ByokConfig, "apiKeyHash" | "createdAt" | "updatedAt"> & { plaintextKey?: string; apiKeyHash?: string }
  ): Promise<ByokConfig> {
    const now = new Date();
    const stored: ByokConfig = {
      ...config,
      apiKeyHash: config.apiKeyHash ?? hashApiKey(required(config.plaintextKey, "plaintextKey")),
      createdAt: now,
      updatedAt: now
    };
    delete (stored as ByokConfig & { plaintextKey?: string }).plaintextKey;
    await this.options.store.saveByokConfig(stored);
    return { ...stored, encryptedKey: "[ENCRYPTED]" };
  }

  public async routeToCustomerLLM(request: ByokRequest, customerId: string, requestId?: string): Promise<Response> {
    const config = await this.options.store.getByokConfig(customerId, request.provider);
    if (!config || config.disabled) {
      throw new Error(`BYOK is not configured for customer ${customerId} and provider ${request.provider}.`);
    }

    await this.audit({
      customerId,
      provider: request.provider,
      model: request.model,
      requestId,
      usedByok: true,
      timestamp: new Date(),
      status: "started"
    });

    let decryptedKey: string | undefined;
    try {
      decryptedKey = await this.options.decryptor.decryptKey(config);
      assertApiKeyMatchesHash(decryptedKey, config.apiKeyHash);

      const endpointUrl = request.endpointUrl ?? defaultEndpointForProvider(request.provider, request.model);
      assertStandardInferenceEndpoint(request.provider, endpointUrl);

      const sanitizedPayload = sanitizeLlmRequestPayload({
        ...request.body,
        model: request.model
      });
      const headers = this.buildHeaders(request.provider, decryptedKey, request.headers, requestId);

      const response = await this.fetchImpl(endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(sanitizedPayload.payload)
      });

      await this.audit({
        customerId,
        provider: request.provider,
        model: request.model,
        requestId,
        usedByok: true,
        timestamp: new Date(),
        status: response.ok ? "succeeded" : "failed",
        statusCode: response.status
      });

      return response;
    } catch (error) {
      await this.audit({
        customerId,
        provider: request.provider,
        model: request.model,
        requestId,
        usedByok: true,
        timestamp: new Date(),
        status: "failed",
        errorClass: error instanceof Error ? error.name : "UnknownError"
      });
      throw new Error(`Customer LLM request failed: ${sanitizePlainText(errorMessage(error))}`);
    } finally {
      decryptedKey = undefined;
    }
  }

  public async disable(customerId: string, provider: ByokProvider): Promise<void> {
    await this.options.store.disableByokConfig(customerId, provider);
  }

  private buildHeaders(
    provider: ByokProvider,
    apiKey: string,
    requestHeaders: ZeroRetentionHeaders = {},
    requestId?: string
  ): Record<string, string> {
    const providerHeaders = buildProviderHeaders(provider, { requestId, extraHeaders: requestHeaders });
    return stringifyHeaders({
      ...providerHeaders,
      ...authorizationHeader(provider, apiKey),
      "content-type": "application/json"
    });
  }

  private async audit(event: ByokAuditEvent): Promise<void> {
    await this.options.auditSink.write(event);
  }
}

export class InMemoryByokConfigStore implements ByokConfigStore {
  private readonly configs = new Map<string, ByokConfig>();

  public async getByokConfig(customerId: string, provider: ByokProvider): Promise<ByokConfig | undefined> {
    const config = this.configs.get(keyFor(customerId, provider));
    return config ? cloneConfig(config) : undefined;
  }

  public async saveByokConfig(config: ByokConfig): Promise<void> {
    this.configs.set(keyFor(config.customerId, config.provider), cloneConfig(config));
  }

  public async disableByokConfig(customerId: string, provider: ByokProvider): Promise<void> {
    const key = keyFor(customerId, provider);
    const existing = this.configs.get(key);
    if (existing) {
      this.configs.set(key, { ...existing, disabled: true, updatedAt: new Date() });
    }
  }
}

export class InMemoryByokAuditSink implements ByokAuditSink {
  private readonly events: ByokAuditEvent[] = [];

  public async write(event: ByokAuditEvent): Promise<void> {
    this.events.push({ ...event, timestamp: new Date(event.timestamp) });
    this.trimToRetentionWindow();
  }

  public list(customerId?: string): ByokAuditEvent[] {
    return this.events
      .filter((event) => !customerId || event.customerId === customerId)
      .map((event) => ({ ...event, timestamp: new Date(event.timestamp) }));
  }

  private trimToRetentionWindow(): void {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const retained = this.events.filter((event) => event.timestamp.getTime() >= cutoff);
    this.events.splice(0, this.events.length, ...retained);
  }
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function assertApiKeyMatchesHash(apiKey: string, expectedHash: string): void {
  if (hashApiKey(apiKey) !== expectedHash) {
    throw new Error("BYOK decrypted key failed integrity validation.");
  }
}

function authorizationHeader(provider: ByokProvider, apiKey: string): Record<string, string> {
  if (provider === "gemini") {
    return { "x-goog-api-key": apiKey };
  }
  if (provider === "anthropic") {
    return { "x-api-key": apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function defaultEndpointForProvider(provider: ByokProvider, model: string): string {
  const config = getZeroRetentionConfig(provider);
  if (provider === "gemini") {
    return `${config.endpoint.baseUrl}${config.endpoint.inferencePath.replace("{model}", encodeURIComponent(model))}`;
  }
  return `${config.endpoint.baseUrl}${config.endpoint.inferencePath}`;
}

function stringifyHeaders(headers: ZeroRetentionHeaders & Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function keyFor(customerId: string, provider: ByokProvider): string {
  return `${customerId}:${provider}`;
}

function cloneConfig(config: ByokConfig): ByokConfig {
  return {
    ...config,
    createdAt: new Date(config.createdAt),
    updatedAt: new Date(config.updatedAt)
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required BYOK value: ${name}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
