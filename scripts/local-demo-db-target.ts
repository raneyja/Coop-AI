/** Guard the analytics demo seed before creating a database pool. */
export function assertLocalDemoDatabaseTarget(value: string): void {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error("seed-analytics-demo requires an explicit local PostgreSQL URL.");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !localHosts.has(target.hostname) ||
    !target.username ||
    target.pathname.length < 2 ||
    target.href.includes("?") ||
    target.href.includes("#")
  ) {
    throw new Error("seed-analytics-demo is local-only. Refusing a non-local or overridden database target.");
  }
}
