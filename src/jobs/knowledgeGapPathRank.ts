import { isGeneratedOrVendorPath, isTestPath } from "../indexing/evidencePathNoise";

const TOOLING_CONFIG =
  /(^|\/)(?:postcss|tailwind|next|nuxt|vite|webpack|babel|jest|eslint|prettier|vitest|playwright|commitlint|karma|rollup|tsup|esbuild)(?:\.config)?\./i;

const TOOLING_BASENAME =
  /^(?:postcss|tailwind|next|vite|webpack|babel|jest|eslint|prettier)\.config\.[cm]?[jt]sx?$/i;

/** Product areas a staff engineer would audit first on a Monday. */
const AREA_PRIORITY: Array<{ test: RegExp; score: number }> = [
  { test: /(^|\/)(extension|CoopChatPanel|CoopSidebarProvider|CoopSettingsPanel)\.ts$/i, score: 90 },
  { test: /^src\/(chat|jobs|api|edit|context)\b/i, score: 80 },
  { test: /^src\/(compliance|config|autocomplete|webview)\b/i, score: 70 },
  { test: /^src\//i, score: 50 },
  { test: /^(apps|packages|services)\//i, score: 40 },
  { test: /^admin\/src\//i, score: 25 },
  { test: /^website\/src\//i, score: 20 }
];

export function isKnowledgeGapToolingPath(path: string): boolean {
  const n = path.replace(/\\/g, "/");
  const base = n.split("/").pop() ?? n;
  return TOOLING_CONFIG.test(n) || TOOLING_BASENAME.test(base);
}

export function isKnowledgeGapHighValuePath(path: string): boolean {
  const n = path.replace(/\\/g, "/");
  if (isGeneratedOrVendorPath(n) || isTestPath(n) || isKnowledgeGapToolingPath(n)) {
    return false;
  }
  if (/\.(md|json|yml|yaml|lock|txt|css|scss)$/i.test(n)) {
    return false;
  }
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php)$/i.test(n);
}

export function knowledgeGapAreaPriority(path: string): number {
  const n = path.replace(/\\/g, "/");
  if (isKnowledgeGapToolingPath(n)) {
    return -100;
  }
  for (const entry of AREA_PRIORITY) {
    if (entry.test.test(n)) {
      return entry.score;
    }
  }
  return 0;
}

/** Prefer chat/api/jobs when listing src/* during the bounded tree walk. */
export const KNOWLEDGE_GAP_PREFERRED_CHILDREN = [
  "chat",
  "jobs",
  "api",
  "edit",
  "context",
  "compliance",
  "config",
  "autocomplete",
  "webview"
];

export function rankKnowledgeGapChildDirs(dirs: string[]): string[] {
  const score = (dir: string): number => {
    const leaf = dir.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
    const idx = KNOWLEDGE_GAP_PREFERRED_CHILDREN.indexOf(leaf);
    return idx >= 0 ? 100 - idx : 0;
  };
  return [...dirs].sort((a, b) => score(b) - score(a));
}
