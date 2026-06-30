import type * as vscode from "vscode";

export type AutocompleteTriggerMode = "auto" | "manual" | "off";

export type AutocompleteModelPreset = "haiku" | "gpt35" | "custom";

export type CopilotPolicy = "warn" | "disable-when-copilot";

export type AutocompleteSettings = {
  enabled: boolean;
  trigger: AutocompleteTriggerMode;
  maxSuggestionLength: number;
  debounceMs: number;
  model: AutocompleteModelPreset;
  customModel: string;
  copilotPolicy: CopilotPolicy;
  showMultipleSuggestions: boolean;
  requestTimeoutMs: number;
  useFim: boolean;
  useGraphContext: boolean;
};

export type TriggerKind = "auto" | "manual" | "paste" | "immediate";

export type CompletionTriggerContext = {
  kind: TriggerKind;
  vscodeKind: vscode.InlineCompletionTriggerKind;
  pasted?: boolean;
};

export type ExtractedCodeContext = {
  languageId: string;
  filePath: string;
  currentLinePrefix: string;
  currentLineSuffix: string;
  suffixWindow: string;
  previousLines: string;
  importsBlock: string;
  parentSignature: string;
  indent: string;
  cursorOffset: number;
  contextHash: string;
  inComment: boolean;
  inString: boolean;
  afterDot: boolean;
  afterOpenParen: boolean;
  riskySyntax: boolean;
};

export type InlineCompletionRequest = {
  context: ExtractedCodeContext;
  trigger: CompletionTriggerContext;
};

export type RankedCompletion = {
  text: string;
  score: number;
  source: "cache" | "llm" | "pattern";
};

export type CompletionRouterResult = {
  completions: RankedCompletion[];
  latencyMs: number;
  fromCache: boolean;
  model?: string;
  provider?: string;
};

export type AutocompleteStatusState =
  | "disabled"
  | "ready"
  | "processing"
  | "error";

export type PerformanceBatchPayload = {
  requestCount: number;
  acceptCount: number;
  rejectCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  lastLatencyMs: number;
};

export type AutocompleteTelemetryEvent = {
  kind: "request" | "accept" | "reject" | "show" | "performance";
  latencyMs?: number;
  reason?: string;
  languageId?: string;
  performance?: PerformanceBatchPayload;
};
