/**
 * Single source of truth for "this path is structural noise, not evidence".
 *
 * Every rule here must hold for **any** repository in **any** language. Naming a
 * specific product, framework, or folder layout is cheating: it makes one demo
 * pass and silently misranks every other customer's code.
 */

/** `index.ts` re-export barrels forward definitions, they never contain them. */
export function isBarrelPath(fileName: string): boolean {
  return /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalizePath(fileName));
}

/** Build output, dependencies, lockfiles, and index artifacts. */
export function isGeneratedOrVendorPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)(node_modules|vendor|third_party|dist|build|out|coverage|\.next|\.turbo)\//.test(n) ||
    /(^|\/)testdata\//.test(n) ||
    /(^|\/)shards\//.test(n) ||
    /\.(min|bundle)\.(js|css)$/.test(n) ||
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|go\.sum|cargo\.lock)$/.test(
      n
    ) ||
    /\.(snap|map|zoekt|pb)$/.test(n) ||
    /\.(generated|g)\.(ts|js|go|py)$/.test(n)
  );
}

export function normalizePath(fileName: string): string {
  return fileName.replace(/\\/g, "/").toLowerCase();
}
