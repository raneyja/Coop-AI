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

/**
 * Unit/contract/spec trees. Fine as evidence for "how is this tested", but for
 * "where is X defined / add logging around X" they steal the definition site.
 */
export function isTestPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)(tests?|__tests__|spec|specs|testing)\//.test(n) ||
    /(^|\/)test_[^/]+\.(py|ts|tsx|js|jsx|mjs|cjs)$/.test(n) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(n) ||
    /(^|\/)[^/]+_test\.(py|go)$/.test(n)
  );
}

/**
 * Locale catalogs and translation JSON. They mention every product word and
 * steal "where is this written / what rejects" hunts.
 */
export function isLocaleCatalogPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)(locales?|i18n|translations?|l10n)\//.test(n) ||
    /(^|\/)locale(s)?\.[^/]+$/.test(n)
  );
}

/**
 * API / server trees — where writes and 4xx checks live. Not packages/utils
 * board grouping, not locale strings.
 */
export function isServerWritePath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return /(^|\/)(api|server|backend|svc)\//.test(n);
}

/**
 * ORM / catalog trees — group enums and default rows, not the request that
 * writes a field or returns 4xx.
 */
export function isSchemaCatalogPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)db\/models\//.test(n) ||
    /(^|\/)models\/[^/]+\.(py|ts|rb|go|java)$/.test(n) ||
    /(^|\/)models\.(py|ts|rb)$/.test(n)
  );
}

/**
 * Views / serializers / services — where an API request is accepted or rejected.
 */
export function isMutationHandlerPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)(views?|serializers?|services?|handlers?|controllers?|endpoints?)\//.test(n) ||
    /\.(serializer|view|handler|controller|service)\.(py|ts|go|rb)$/.test(n)
  );
}

/**
 * Web/client trees. They post `state_id`; they do not reject the API call.
 */
export function isClientUiPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return /(^|\/)(web|frontend|client)\//.test(n);
}

/**
 * Seed/fixture JSON — sample rows with state_id, not the API that rejects.
 */
export function isSeedOrFixturePath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)(seeds?|fixtures?|factories)\//.test(n) ||
    /\.json$/.test(n)
  );
}

/**
 * OpenAPI / swagger / docs — they mention every product noun and are not the
 * write/reject implementation.
 */
export function isDocOrSpecPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)(docs?|documentation)\//.test(n) ||
    /(^|\/)openapi\.(py|yml|yaml|json|ts)$/.test(n) ||
    /(^|\/)swagger\.(py|yml|yaml|json|ts)$/.test(n) ||
    /(^|\/)(readme|changelog)(\.|$)/.test(n)
  );
}

/**
 * Query-filter helpers — they validate filter values, they do not write a
 * work-item field or reject a state transition.
 */
export function isQueryFilterPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return /(^|\/)(filters?|querysets?)\//.test(n);
}

export function normalizePath(fileName: string): string {
  return fileName.replace(/\\/g, "/").toLowerCase();
}
