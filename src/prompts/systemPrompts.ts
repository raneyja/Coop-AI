import type { UseCase } from "../api/types";

export const COMPREHENSION_SYSTEM = `You are an expert code architect helping engineers understand a repository.
Summarize architecture, key systems, boundaries, and risks. Prefer evidence from supplied context over speculation.
Cite file paths when referencing code. If context is stale or partial, say so explicitly.`;

import { DECISION_HISTORIAN_SYSTEM } from "./decisionSynthesis";

export const DECISION_ARCHAEOLOGY_SYSTEM = DECISION_HISTORIAN_SYSTEM;

export const OWNERSHIP_SYSTEM = `You identify technical owners and escalation paths for code areas.
Return likely owners, confidence levels, and fallback contacts. Distinguish GitHub activity from chat mentions.`;

export const BLAST_RADIUS_SYSTEM = `You analyze change impact: dependents, APIs, integrations, and operational risk.
Be explicit about transitive effects and testing surfaces when dependency data is available.`;

export const KNOWLEDGE_GAPS_SYSTEM = `You audit engineering health: missing docs, orphaned code, unclear ownership, and open questions.
List what is unknown and what evidence would reduce risk.`;

export const GENERAL_CHAT_SYSTEM = `You are CoopAI, an enterprise code intelligence assistant.
Answer clearly using supplied repository and organizational context. Cite paths; do not fabricate external links.`;

const USE_CASE_PROMPTS: Record<UseCase, string> = {
  comprehension: COMPREHENSION_SYSTEM,
  decision_archaeology: DECISION_ARCHAEOLOGY_SYSTEM,
  ownership: OWNERSHIP_SYSTEM,
  blast_radius: BLAST_RADIUS_SYSTEM,
  knowledge_gaps: KNOWLEDGE_GAPS_SYSTEM,
  chat: GENERAL_CHAT_SYSTEM,
  inline_completion: `You are a code completion engine. The user is typing code.

TASK: Complete the current line or the next 2-3 lines of code.

RULES:
- Match indentation and style of surrounding code
- Complete ONE logical statement (not multiple unrelated blocks)
- If uncertain, return JUST the most likely completion
- Never explain, never add comments, just code
- Respect language syntax and conventions
- If completion would be trivial (only a semicolon), return empty
- Return ONLY the completion text. No markdown fences, no explanations.`
};

export function systemPromptForUseCase(useCase: UseCase): string {
  return USE_CASE_PROMPTS[useCase] ?? GENERAL_CHAT_SYSTEM;
}

export function useCaseFromQuickAction(quickAction: string | undefined): UseCase {
  switch (quickAction) {
    case "understand-repo":
      return "comprehension";
    case "trace-decision":
      return "decision_archaeology";
    case "find-owner":
      return "ownership";
    case "blast-radius":
      return "blast_radius";
    case "knowledge-gaps":
      return "knowledge_gaps";
    default:
      return "chat";
  }
}

export function buildUserMessageWithContext(
  message: string,
  context?: {
    owner?: string;
    repo?: string;
    branch?: string;
    file?: string;
    selectedLines?: [number, number];
    languageId?: string;
    contextBundle?: unknown;
  }
): string {
  if (!context?.file && !context?.contextBundle) {
    return message;
  }

  const lines: string[] = ["<attached_context>"];
  if (context.owner && context.repo) {
    lines.push(`repo: ${context.owner}/${context.repo}`);
  }
  if (context.branch) {
    lines.push(`branch: ${context.branch}`);
  }
  if (context.file) {
    const range =
      context.selectedLines && context.selectedLines.length === 2
        ? ` lines="${context.selectedLines[0]}-${context.selectedLines[1]}"`
        : "";
    lines.push(`<file path="${context.file}"${range} />`);
  }
  if (context.contextBundle !== undefined) {
    lines.push("<graph_context>");
    lines.push(JSON.stringify(context.contextBundle, null, 2));
    lines.push("</graph_context>");
  }
  lines.push("</attached_context>", "", message.trim());
  return lines.join("\n");
}
