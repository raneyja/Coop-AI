import type { QuickActionId } from "../webview/types";
import type { RepoContext } from "../chat/types";

export function quickActionPrompt(actionId: QuickActionId, ctx: RepoContext): string {
  switch (actionId) {
    case "understand-repo":
      return `Understand this repository quickly.\nContext:\n- file: ${ctx.file || "unknown"}\n- branch: ${ctx.branch || "unknown"}\n- language: ${ctx.languageId || "unknown"}\nFocus on architecture, key systems, and likely risks.`;
    case "trace-decision": {
      const lineHint = ctx.selectedLines ? `${ctx.selectedLines[0]}-${ctx.selectedLines[1]}` : "none";
      return `Trace the likely engineering decision behind this code.\nContext:\n- file: ${ctx.file || "unknown"}\n- selected lines: ${lineHint}\nProvide likely rationale, tradeoffs, and alternatives.`;
    }
    case "find-owner":
      return `Find likely owner(s) for this area.\nContext:\n- file: ${ctx.file || "unknown"}\n- repo: ${ctx.owner || "unknown"}/${ctx.repo || "unknown"}\nInclude confidence and fallback contacts.`;
    case "blast-radius":
      return `Estimate blast radius for modifying this area.\nContext:\n- file: ${ctx.file || "unknown"}\n- language: ${ctx.languageId || "unknown"}\nInclude integration, API, and operational risks.`;
    case "knowledge-gaps":
      return `List key unknowns in this code area.\nContext:\n- file: ${ctx.file || "unknown"}\n- branch: ${ctx.branch || "unknown"}\nReturn open questions and what evidence is needed.`;
  }
}
