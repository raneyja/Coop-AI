import type { SecureApiClient } from "../chat/SecureApiClient";
import { readConfiguration } from "../chat/SecureApiClient";
import { buildRepoId } from "../chat/buildRepoId";
import { toRepositoryRelativePath } from "../context/repoFilePath";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import { resolveInlineModelPreset, resolveChatModelPreset } from "../config/inlineModelPresets";
import { resolveEffectiveUseGraphContext } from "./autocompleteConfig";
import type { IndexBackend } from "../indexing/indexBackend";
import { buildPromptContextBlock, languageSpecificHints, wantsMultiLineCompletion } from "./contextAnalyzer";
import { filterAndRankCompletions, normalizeCompletionText, type SymbolPlausibilityHints } from "./completionFilter";
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
  indexBackend?: IndexBackend;
};

const MAX_FIM_PREFIX_CHARS = 4_000;
const SINGLE_LINE_MAX_TOKENS = 96;
const MULTI_LINE_MAX_TOKENS = 200;
const MANIFEST_SYMBOL_CACHE_TTL_MS = 5 * 60 * 1000;
const MANIFEST_SYMBOL_FETCH_TIMEOUT_MS = 120;

type ManifestSymbolCacheEntry = {
  symbols: Set<string>;
  expiresAt: number;
};

type InFlightEntry = {
  prefix: string;
  contextHash: string;
  promise: Promise<CompletionRouterResult>;
  controller: AbortController;
};

export class CompletionRouter {
  private readonly cache: CompletionCache;
  private readonly inFlightByDoc = new Map<string, InFlightEntry>();
  private manifestSymbolCache: { repoId: string; entry: ManifestSymbolCacheEntry } | undefined;

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

    const docKey = context.filePath;
    const prefixKey = buildFimPrefix(context) || context.currentLinePrefix;
    const existing = this.inFlightByDoc.get(docKey);
    if (existing && !existing.controller.signal.aborted) {
      const prefixCompatible =
        prefixKey.startsWith(existing.prefix) && prefixKey.length > existing.prefix.length;
      const sameHash = existing.contextHash === context.contextHash;
      if (prefixCompatible || sameHash) {
        return existing.promise;
      }
      existing.controller.abort();
      this.inFlightByDoc.delete(docKey);
    }

    const controller = new AbortController();
    const promise = this.executeFetch(context, settings, signal, controller, timer);
    this.inFlightByDoc.set(docKey, {
      prefix: prefixKey,
      contextHash: context.contextHash,
      promise,
      controller
    });

    try {
      return await promise;
    } finally {
      const current = this.inFlightByDoc.get(docKey);
      if (current?.promise === promise) {
        this.inFlightByDoc.delete(docKey);
      }
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private async executeFetch(
    context: ExtractedCodeContext,
    settings: AutocompleteSettings,
    signal: AbortSignal | undefined,
    controller: AbortController,
    timer: ReturnType<typeof createLatencyTimer>
  ): Promise<CompletionRouterResult> {
    const linked = linkAbort(signal, controller.signal);

    timer.markAssembly();
    const safeContext = sanitizeContextForRequest(context);
    const prompt = buildAutocompleteUserMessage(safeContext);
    const segments = buildFimSegments(safeContext, settings.useFim);
    timer.markNetworkStart();

    const prefs = readConfiguration();
    const preset = resolveModelPreset(settings, prefs);
    const multiLine = wantsMultiLineCompletion(safeContext);
    const maxTokens = multiLine ? MULTI_LINE_MAX_TOKENS : SINGLE_LINE_MAX_TOKENS;

    try {
      const timeoutMs = settings.requestTimeoutMs;
      const result = await raceWithTimeout(
        this.requestWithFallback(
          prompt,
          safeContext,
          segments,
          preset,
          prefs.apiBaseUrl,
          linked,
          maxTokens,
          settings,
          prefs
        ),
        timeoutMs,
        linked
      );
      timer.markNetworkEnd();

      const alternatives = result.alternatives
        .map((t) => normalizeCompletionText(t, safeContext))
        .filter(Boolean);
      const primary = normalizeCompletionText(result.text, safeContext);
      timer.markParseEnd();
      const breakdown = timer.finish();

      const folder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(context.filePath)
      );
      const profile = getProjectStyleProfile(folder ?? undefined);
      const fileSample = safeContext.previousLines.slice(0, 2000);
      const symbolHints = await this.resolveSymbolHints(context, settings, prefs);

      let ranked = filterAndRankCompletions(
        [primary, ...alternatives].filter(Boolean),
        context,
        settings,
        fileSample,
        symbolHints
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
      const message = error instanceof Error ? error.message : "Autocomplete failed";
      console.warn("[CoopAI autocomplete]", message);
      return {
        completions: [],
        latencyMs: breakdown.totalMs,
        fromCache: false,
        error: message
      };
    }
  }

  private async resolveSymbolHints(
    context: ExtractedCodeContext,
    settings: AutocompleteSettings,
    prefs: ReturnType<typeof readConfiguration>
  ): Promise<SymbolPlausibilityHints | undefined> {
    if (!settings.useGraphContext) {
      return undefined;
    }

    const repoId = buildRepoId(prefs);
    if (repoId.includes("unknown/unknown")) {
      return undefined;
    }

    const manifestSymbols = await this.loadManifestSymbols(repoId, prefs.apiBaseUrl);
    if (!manifestSymbols?.size) {
      return undefined;
    }
    return { manifestSymbols };
  }

  private async loadManifestSymbols(
    repoId: string,
    baseUrl: string
  ): Promise<Set<string> | undefined> {
    const cached = this.manifestSymbolCache;
    if (cached?.repoId === repoId && Date.now() < cached.entry.expiresAt) {
      return cached.entry.symbols;
    }

    try {
      const manifest = await raceWithTimeout(
        this.deps.api.fetchRepoManifest(baseUrl, repoId),
        MANIFEST_SYMBOL_FETCH_TIMEOUT_MS,
        new AbortController().signal
      );
      const symbols = new Set<string>();
      for (const file of manifest.files ?? []) {
        for (const symbol of file.symbols ?? []) {
          if (symbol.name) {
            symbols.add(symbol.name);
          }
        }
      }
      if (symbols.size > 0) {
        this.manifestSymbolCache = {
          repoId,
          entry: {
            symbols,
            expiresAt: Date.now() + MANIFEST_SYMBOL_CACHE_TTL_MS
          }
        };
        return symbols;
      }
    } catch {
      // fail-open — local context penalties still apply
    }

    return cached?.repoId === repoId ? cached.entry.symbols : undefined;
  }

  private async requestWithFallback(
    prompt: string,
    context: ExtractedCodeContext,
    segments: { prefix: string; suffix: string } | undefined,
    preset: { provider: LlmProvider; model: string; fallback?: { provider: LlmProvider; model: string } },
    baseUrl: string,
    signal: AbortSignal,
    maxTokens: number,
    settings: AutocompleteSettings,
    prefs: ReturnType<typeof readConfiguration>
  ): Promise<{ text: string; alternatives: string[]; model: string; provider: string }> {
    const chatMessage = segments
      ? synthesizeMessageFromSegments(segments, context, prompt)
      : prompt;
    const repoId = buildRepoId(prefs);
    const repoStatus = this.deps.indexBackend
      ? await this.deps.indexBackend.getRepoStatus(repoId)
      : undefined;
    const useGraphContext = resolveEffectiveUseGraphContext(settings, repoStatus);
    const body = {
      message: chatMessage,
      segments,
      languageId: context.languageId,
      file: context.filePath,
      provider: preset.provider,
      model: preset.model,
      maxTokens,
      temperature: 0.15,
      ...(useGraphContext
        ? {
            useGraphContext: true,
            repoId,
            file: toRepositoryRelativePath(context.filePath)
          }
        : {})
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
      useGraphContext?: boolean;
      repoId?: string;
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
        const normalized = normalizeCompletionText(buffered, undefined);
        if (normalized) {
          lastValid = normalized;
        }
      },
      signal
    );

    const text = lastValid || normalizeCompletionText(result.text, undefined) || buffered.trim();
    return { ...result, text, alternatives: result.alternatives ?? [] };
  }
}

export function synthesizeMessageFromSegments(
  segments: { prefix: string; suffix: string },
  context: ExtractedCodeContext,
  fallbackPrompt: string
): string {
  const hints = languageSpecificHints(context);
  const prefix = segments.prefix.trim();
  if (!prefix) {
    return fallbackPrompt;
  }
  return `${hints}\n\nPREFIX:\n${segments.prefix}\n\nSUFFIX:\n${segments.suffix}\n\nTASK: Complete the code at the cursor position (between PREFIX and SUFFIX). Return ONLY the completion text.`;
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
  prefs: ReturnType<typeof readConfiguration>
): { provider: LlmProvider; model: string; fallback?: { provider: LlmProvider; model: string } } {
  if (settings.model === "chat") {
    return resolveChatModelPreset(prefs.llmProvider as LlmProvider, prefs.model);
  }
  return resolveInlineModelPreset(
    settings.model,
    settings.customModel,
    prefs.llmProvider as LlmProvider
  );
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
