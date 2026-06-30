import type { ParseState } from "./baseClient";
import { parseSseDataLine } from "./baseClient";
import type { StreamChunk } from "../types";

/** Parse OpenAI-style legacy /completions SSE lines (Mistral FIM, DeepSeek FIM). */
export function parseCompletionSseLine(line: string, state: ParseState): StreamChunk | undefined {
  const data = parseSseDataLine(line) as Record<string, unknown> | undefined;
  if (!data) {
    return undefined;
  }
  const usage = data.usage as Record<string, unknown> | undefined;
  if (usage) {
    const promptTokens = readUsageInt(usage.prompt_tokens);
    const completionTokens = readUsageInt(usage.completion_tokens);
    if (promptTokens !== undefined) {
      state.inputTokens = promptTokens;
    }
    if (completionTokens !== undefined) {
      state.outputTokens = completionTokens;
    }
  }
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const choice = choices[0] as Record<string, unknown>;
  const text =
    typeof choice.text === "string"
      ? choice.text
      : typeof (choice.delta as Record<string, unknown> | undefined)?.content === "string"
        ? ((choice.delta as Record<string, unknown>).content as string)
        : "";
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason === "length" ? "length" : "stop";
  }
  if (!text) {
    return undefined;
  }
  return { type: "delta", text };
}

function readUsageInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}
