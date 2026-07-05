import * as vscode from "vscode";

/** When true, plain chat may attach query-driven repo snippets from the index. */
export function readSemanticRetrievalEnabled(): boolean {
  return vscode.workspace.getConfiguration("coopAI.chat").get<boolean>("semanticRetrieval", true);
}
