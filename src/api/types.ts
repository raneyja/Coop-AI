import type { ChatImageAttachment } from "../chat/types";
import type { ChatRequestMessage } from "./requestFormatter";
import type { LlmProvider } from "./zeroRetentionConfig";

export type { ChatImageAttachment };

export type { LlmProvider };

export type UseCase =
  | "comprehension"
  | "decision_archaeology"
  | "ownership"
  | "blast_radius"
  | "knowledge_gaps"
  | "chat"
  | "inline_completion";

export type FinishReason = "stop" | "length" | "error" | "cancelled";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type ModelRuntimeConfig = {
  provider: LlmProvider;
  model: string;
  temperature: number;
  maxTokens: number;
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatImageAttachment[];
};

export type ChatContextPayload = {
  owner?: string;
  repo?: string;
  branch?: string;
  file?: string;
  selectedLines?: [number, number];
  languageId?: string;
  contextBundle?: unknown;
};

export type ChatOrgPlan = "free" | "pro" | "enterprise";

export type CompletionRequest = {
  requestId: string;
  orgId: string;
  plan: ChatOrgPlan;
  message: string;
  history: ChatHistoryMessage[];
  context?: ChatContextPayload;
  attachments?: ChatImageAttachment[];
  useCase: UseCase;
  modelConfig: ModelRuntimeConfig;
  allowUnapprovedProvider?: boolean;
};

export type CompletionResponse = {
  text: string;
  usage: TokenUsage;
  model: string;
  provider: LlmProvider;
  finishReason: FinishReason;
};

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; usage: TokenUsage; model: string; provider: LlmProvider; finishReason: FinishReason }
  | { type: "error"; message: string; code?: string };

export type V1ChatRequestBody = {
  message: string;
  history?: ChatHistoryMessage[];
  context?: ChatContextPayload;
  attachments?: ChatImageAttachment[];
  mentions?: Array<{ path: string; lines?: [number, number] }>;
  model?: string;
  provider?: LlmProvider;
  useCase?: UseCase;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
};

export type ProviderStreamOptions = {
  messages: ChatRequestMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  requestId: string;
};

export type LlmAuditEvent = {
  requestId: string;
  orgId: string;
  plan: ChatOrgPlan;
  provider: LlmProvider;
  model: string;
  useCase: UseCase;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "ok" | "error";
  errorClass?: string;
};
