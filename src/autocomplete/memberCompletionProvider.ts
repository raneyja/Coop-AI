import { sanitizeAfterDotMemberText, afterDotMemberDedupeKey } from "./completionFilter";
import * as vscode from "vscode";
import type { ExtractedCodeContext, RankedCompletion } from "./types";

const JS_LIKE_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact"
]);

const MEMBER_COMPLETION_KINDS = new Set<vscode.CompletionItemKind>([
  vscode.CompletionItemKind.Method,
  vscode.CompletionItemKind.Function,
  vscode.CompletionItemKind.Constructor,
  vscode.CompletionItemKind.Field,
  vscode.CompletionItemKind.Variable,
  vscode.CompletionItemKind.Property,
  vscode.CompletionItemKind.EnumMember,
  vscode.CompletionItemKind.Event,
  vscode.CompletionItemKind.Constant
]);

const CALLABLE_MEMBER_KINDS = new Set<vscode.CompletionItemKind>([
  vscode.CompletionItemKind.Method,
  vscode.CompletionItemKind.Function,
  vscode.CompletionItemKind.Constructor
]);

const DEFAULT_LSP_TIMEOUT_MS = 1_000;
const MAX_LSP_SUGGESTIONS = 8;

/** Prefer API-relevant members when the receiver is vscode.window. */
const VSCODE_WINDOW_MEMBER_PRIORITY = [
  "createWebviewPanel",
  "showInformationMessage",
  "showWarningMessage",
  "showErrorMessage",
  "showQuickPick",
  "createQuickPick",
  "createStatusBarItem",
  "createTerminal",
  "createOutputChannel",
  "createInputBox",
  "withProgress"
] as const;

export function resolveLspTriggerCharacter(context: ExtractedCodeContext): string | undefined {
  if (context.afterDot) {
    return ".";
  }
  return undefined;
}

function windowMemberPriorityScore(memberText: string): number {
  const name = afterDotMemberDedupeKey(memberText);
  const index = VSCODE_WINDOW_MEMBER_PRIORITY.indexOf(name as (typeof VSCODE_WINDOW_MEMBER_PRIORITY)[number]);
  return index >= 0 ? VSCODE_WINDOW_MEMBER_PRIORITY.length - index : 0;
}

export function rankAfterDotLspMembers(
  ranked: RankedCompletion[],
  linePrefix: string
): RankedCompletion[] {
  if (!/vscode\.window\.\s*$/.test(linePrefix)) {
    return ranked;
  }
  return [...ranked].sort((left, right) => {
    const priorityDelta = windowMemberPriorityScore(right.text) - windowMemberPriorityScore(left.text);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return right.score - left.score;
  });
}

export function isAfterDotMemberCompletionEligible(context: ExtractedCodeContext): boolean {
  return context.afterDot && JS_LIKE_LANGUAGES.has(context.languageId);
}

export function isMemberCompletionKind(kind: vscode.CompletionItemKind | undefined): boolean {
  if (kind === undefined) {
    return true;
  }
  return MEMBER_COMPLETION_KINDS.has(kind);
}

export function stripSnippetPlaceholders(text: string): string {
  return text.replace(/\$\{\d+(?::[^}]*)?\}/g, "").replace(/\$\d+/g, "");
}

export function resolveRawInsertText(item: vscode.CompletionItem): string {
  if (item.textEdit && "newText" in item.textEdit) {
    return item.textEdit.newText;
  }
  if (typeof item.insertText === "string") {
    return item.insertText;
  }
  if (item.insertText && typeof item.insertText === "object" && "value" in item.insertText) {
    return item.insertText.value;
  }
  if (typeof item.label === "string") {
    return item.label;
  }
  return item.label.label;
}

export function normalizeMemberInsertText(item: vscode.CompletionItem): string {
  const kind = item.kind;
  if (!isMemberCompletionKind(kind)) {
    return "";
  }

  const label =
    typeof item.label === "string" ? item.label : item.label.label.trim();
  if (!/^[A-Za-z_$][\w$]*/.test(label)) {
    return "";
  }

  const raw = stripSnippetPlaceholders(resolveRawInsertText(item)).trim();
  if (raw.includes("\n")) {
    return "";
  }
  const memberMatch = /^([A-Za-z_$][\w$]*)/.exec(raw || label);
  if (!memberMatch) {
    return "";
  }

  let insert = memberMatch[1];
  const callable = kind !== undefined && CALLABLE_MEMBER_KINDS.has(kind);
  if (callable) {
    const hasOpenParen = raw.includes("(") || label.includes("(");
    if (hasOpenParen && !insert.endsWith("(")) {
      insert += "(";
    } else if (hasOpenParen) {
      // already has paren from memberMatch - unlikely
    } else {
      insert += "(";
    }
  }
  return insert;
}

export function filterMemberCompletionItems(items: readonly vscode.CompletionItem[]): vscode.CompletionItem[] {
  return items.filter((item) => {
    if (item.kind !== undefined && !isMemberCompletionKind(item.kind)) {
      return false;
    }
    const label = typeof item.label === "string" ? item.label : item.label.label;
    return /^[A-Za-z_$][\w$]*/.test(label.trim());
  });
}

export function lspItemsToRankedCompletions(
  items: readonly vscode.CompletionItem[],
  linePrefix?: string
): RankedCompletion[] {
  const ranked: RankedCompletion[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const text = sanitizeAfterDotMemberText(normalizeMemberInsertText(item));
    if (!text || seen.has(afterDotMemberDedupeKey(text))) {
      continue;
    }
    if (linePrefix && text.includes("CoopSettingsPanel") && !linePrefix.includes("CoopSettingsPanel")) {
      continue;
    }
    seen.add(afterDotMemberDedupeKey(text));
    ranked.push({
      text,
      score: Math.max(0.1, 1 - ranked.length * 0.05),
      source: "lsp"
    });
    if (ranked.length >= MAX_LSP_SUGGESTIONS) {
      break;
    }
  }

  return ranked;
}

function asCompletionItems(
  result: vscode.CompletionList | vscode.CompletionItem[] | null | undefined
): vscode.CompletionItem[] {
  if (!result) {
    return [];
  }
  if (Array.isArray(result)) {
    return result;
  }
  return result.items ?? [];
}

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("LSP member completion aborted"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("LSP member completion aborted"));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("LSP member completion timed out"));
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    promise
      .then((value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          reject(new Error("LSP member completion aborted"));
          return;
        }
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}

export async function fetchAfterDotMemberCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: ExtractedCodeContext,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<RankedCompletion[]> {
  if (!isAfterDotMemberCompletionEligible(context)) {
    return [];
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_LSP_TIMEOUT_MS;
  const signal = options.signal;

  try {
    const triggerCharacter = resolveLspTriggerCharacter(context);
    const result = await raceWithTimeout(
      Promise.resolve(
        vscode.commands.executeCommand<vscode.CompletionList | vscode.CompletionItem[]>(
          "vscode.executeCompletionItemProvider",
          document.uri,
          position,
          triggerCharacter,
          MAX_LSP_SUGGESTIONS * 2
        )
      ),
      timeoutMs,
      signal
    );
    if (signal?.aborted) {
      return [];
    }
    const filtered = filterMemberCompletionItems(asCompletionItems(result));
    const ranked = lspItemsToRankedCompletions(filtered, context.currentLinePrefix);
    return rankAfterDotLspMembers(ranked, context.currentLinePrefix);
  } catch {
    return [];
  }
}
