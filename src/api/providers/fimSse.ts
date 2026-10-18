import type { ParseState } from "./baseClient";
import { parseSseDataLine, readUsageInt } from "./baseClient";
import type { StreamChunk } from "../types";

/** Parse OpenAI-style legacy /completions SSE lines (Mistral FIM, DeepSeek FIM). */
export function parseCompletionSseLine(line: string, state: ParseState): StreamChunk | undefined {
  if (line.trim() === "data: [DONE]") {state.streamTerminated = true; state.usageTerminal = state.finishReason !== undefined; return undefined;}
  const data = parseSseDataLine(line) as Record<string, unknown> | undefined;
  if (!data) {
    return undefined;
  }
  if (state.streamTerminated) return {type:"error",message:"Provider returned data after its terminal marker."};
  if (data.error) return {type:"error",message:"Provider returned a streaming error."};
  const usage = data.usage as Record<string, unknown> | undefined;
  if (usage) {
    state.inputTokens = readUsageInt(usage.prompt_tokens); state.outputTokens = readUsageInt(usage.completion_tokens);
    const total = readUsageInt(usage.total_tokens);
    state.usageComplete = state.inputTokens !== undefined && state.outputTokens !== undefined
      && Number.isSafeInteger(state.inputTokens + state.outputTokens) && total === state.inputTokens + state.outputTokens;
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
  if (state.finishReason && (text || typeof choice.finish_reason === "string" && choice.finish_reason))
    return {type:"error",message:"Provider returned content after its completion reason."};
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason === "length" ? "length" : choice.finish_reason === "stop" ? "stop" : "error";
  }
  if (!text) {
    return undefined;
  }
  return { type: "delta", text };
}

