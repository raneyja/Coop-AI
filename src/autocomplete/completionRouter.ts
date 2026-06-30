import type { SecureApiClient } from "../chat/SecureApiClient";
import { readConfiguration } from "../chat/SecureApiClient";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import { resolveInlineModelPreset } from "../config/inlineModelPresets";
import { buildPromptContextBlock, languageSpecificHints } from "./contextAnalyzer";
import { filterAndRankCompletions, normalizeCompletionText } from "./completionFilter";
import { biasCompletionsWithProjectStyle, getProjectStyleProfile } from "./customization";
import { applyEdgeCaseFallbacks } from "./edgeCases";
import { CompletionCache, createLatencyTimer, type AutocompletePerformanceMonitor } from "./performance";
import { sanitizeContextForRequest, shouldSkipForPrivacy } from "./privacy";
import type { AutocompleteSettings, CompletionRouterResult, ExtractedCodeContext } from "./types";
import * as vscode from "vscode";

export type CompletionRouterDeps = {
  api: SecureApiClient;
  performance: AutocompletePerformanceMonitor;
  cache?: CompletionCache;
};

const MAX_FIM_PREFIX_CHARS = 4_000;

export class CompletionRouter {
  private readonly cache: CompletionCache;
  private inFlight = new Map<string, AbortController>();

  public constructor(private readonly deps: CompletionRouterDeps) {
    this.cache = deps.cache ?? new CompletionCache();
  }

  public async fetchCompletions(
    context: ExtractedCodeContext,
    settings: AutocompleteSettings,
    signal?: AbortSignal
  ): Promise<CompletionRouterResult> {
    const timer = createLatencyTimer();

    if (shouldSkipForPrivacy(context)) {
      return { completions: [], latencyMs: 0, fromCache: false };
    }

    const cached = this.cache.get(context.contextHash);
    if (cached) {
      return {
        completions: [
          { text: cached.text, score: 1, source: "cache" },
          ...cached.alternatives.map((text) => ({ text, score: 0.9, source: "cache" as const }))
        ],
        latencyMs: 0,
        fromCache: true
      };
    }

    const existing = this.inFlight.get(context.contextHash);
    if (existing) {
      existing.abort();
    }
    const controller = new AbortController();
    this.inFlight.set(context.contextHash, controller);
    const linked = linkAbort(signal, controller.signal);

    timer.markAssembly();
    const safeContext = sanitizeContextForRequest(context);
    const prompt = buildAutocompleteUserMessage(safeContext);
    const segments = buildFimSegments(safeContext, settings.useFim);
    timer.markNetworkStart();

    const prefs = readConfiguration();
    const preset = resolveModelPreset(settings, prefs.llmProvider as LlmProvider);

    try {
      const timeoutMs = settings.requestTimeoutMs;
      const result = await raceWithTimeout(
        this.requestWithFallback(prompt, safeContext, segments, preset, prefs.apiBaseUrl, linked),
        timeoutMs,
        linked
      );
      timer.markNetworkEnd();

      const alternatives = result.alternatives.map((t) => normalizeCompletionText(t)).filter(Boolean);
      const primary = normalizeCompletionText(result.text);
      timer.markParseEnd();
      const breakdown = timer.finish();

      const folder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(context.filePath)
      );
      const profile = getProjectStyleProfile(folder ?? undefined);
      const fileSample = safeContext.previousLines.slice(0, 2000);

      let ranked = filterAndRankCompletions(
        [primary, ...alternatives].filter(Boolean),
        context,
        settings,
        fileSample
      );
      ranked = biasCompletionsWithProjectStyle(ranked, context, profile);
      ranked = applyEdgeCaseFallbacks(context, ranked);

      if (ranked.length > 0) {
        this.cache.set(
          context.contextHash,
          ranked[0].text,
          ranked.slice(1).map((r) => r.text)
        );
      }

      this.deps.performance.recordRequest(breakdown, context.languageId);

      return {
        completions: ranked,
        latencyMs: breakdown.totalMs,
        fromCache: false,
        model: result.model,
        provider: result.provider
      };
    } catch (error) {
      timer.markNetworkEnd();
      timer.markParseEnd();
      const breakdown = timer.finish();
      this.deps.performance.recordRequest(breakdown, context.languageId);
      if (controller.signal.aborted) {
        return { completions: [], latencyMs: breakdown.totalMs, fromCache: false };
      }
      console.warn("[CoopAI autocomplete]", error instanceof Error ? error.message : error);
      return { completions: [], latencyMs: breakdown.totalMs, fromCache: false };
    } finally {
      this.inFlight.delete(context.contextHash);
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private async requestWithFallback(
    prompt: string,
    context: ExtractedCodeContext,
    segments: { prefix: string; suffix: string } | undefined,
    preset: { provider: LlmProvider; model: string; fallback?: { provider: LlmProvider; model: string } },
    baseUrl: string,
    signal: AbortSignal
  ): Promise<{ text: string; alternatives: string[]; model: string; provider: string }> {
    const body = {
      message: segments ? undefined : prompt,
      segments,
      languageId: context.languageId,
      file: context.filePath,
      provider: preset.provider,
      model: preset.model,
      maxTokens: 96,
      temperature: 0.15
    };

    try {
      return await this.requestStreaming(body, baseUrl, signal);
    } catch (primaryError) {
      if (!preset.fallback || signal.aborted) {
        throw primaryError;
      }
      return this.requestStreaming(
        {
          ...body,
          provider: preset.fallback.provider,
          model: preset.fallback.model
        },
        baseUrl,
        signal
      );
    }
  }

  private async requestStreaming(
    body: {
      message?: string;
      segments?: { prefix: string; suffix: string };
      languageId: string;
      file: string;
      provider: LlmProvider;
      model: string;
      maxTokens: number;
      temperature: number;
    },
    baseUrl: string,
    signal: AbortSignal
  ): Promise<{ text: string; alternatives: string[]; model: string; provider: string }> {
    let buffered = "";
    let lastValid = "";

    const result = await this.deps.api.streamInlineCompletion(
      baseUrl,
      body,
      (chunk) => {
        buffered += chunk;
        const normalized = normalizeCompletionText(buffered);
        if (normalized) {
          lastValid = normalized;
        }
      },
      signal
    );

    const text = lastValid || normalizeCompletionText(result.text) || buffered.trim();
    return { ...result, text, alternatives: result.alternatives ?? [] };
  }
}

export function buildFimSegments(
  context: ExtractedCodeContext,
  useFim: boolean
): { prefix: string; suffix: string } | undefined {
  if (!useFim) {
    return undefined;
  }
  const prefix = buildFimPrefix(context);
  if (!prefix.trim()) {
    return undefined;
  }
  return {
    prefix: prefix.slice(0, MAX_FIM_PREFIX_CHARS),
    suffix: context.suffixWindow ?? context.currentLineSuffix
  };
}

function buildFimPrefix(context: ExtractedCodeContext): string {
  const parts: string[] = [];
  if (context.previousLines) {
    parts.push(context.previousLines);
  }
  if (context.currentLinePrefix) {
    parts.push(context.currentLinePrefix);
  }
  return parts.join("\n");
}

function buildAutocompleteUserMessage(context: ExtractedCodeContext): string {
  const block = buildPromptContextBlock(context);
  const hints = languageSpecificHints(context);
  return `${block}\n\nHINT: ${hints}\n\nTASK: Complete the current line or next 2-3 lines. Return ONLY code.`;
}

function resolveModelPreset(
  settings: AutocompleteSettings,
  defaultProvider: LlmProvider
): { provider: LlmProvider; model: string; fallback?: { provider: LlmProvider; model: string } } {
  return resolveInlineModelPreset(settings.model, settings.customModel, defaultProvider);
}

function linkAbort(outer: AbortSignal | undefined, inner: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener("abort", abort);
  inner.addEventListener("abort", abort);
  return controller.signal;
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Autocomplete request timed out."));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Autocomplete request aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}
