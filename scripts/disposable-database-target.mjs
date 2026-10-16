// Pure admission: destructive database suites must call this before any client/pool.
import { parse } from "pg-connection-string";

export function admitDisposableDatabaseTarget(value, expected = {port: "56547", database: "eh10_disposable", user: "eh10"}) {
  // Fixture identity is hardcoded by each suite, never selected from its URL or env.
  if (!expected || !/^\d{4,5}$/.test(String(expected.port)) || Number(expected.port) < 1024 || Number(expected.port) > 65535 ||
      !/^eh\d+_disposable$/.test(expected.database) || !/^eh\d+$/.test(expected.user)) {
    throw new Error("Invalid dedicated disposable fixture identity");
  }
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Invalid disposable database URL"); }
  // No query parameter is needed on the base fixture URL. Reject all, including
  // duplicate/case-variant/percent-encoded pg target and session overrides.
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.href.includes("?") || url.href.includes("#") ||
      !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== String(expected.port) ||
      url.pathname !== "/" + expected.database || url.username !== expected.user || !url.password) {
    throw new Error("Refusing a target outside the dedicated disposable container");
  }
  let effective;
  try { effective = parse(url.toString()); }
  catch { throw new Error("Invalid disposable database configuration"); }
  if (effective.host !== url.hostname || String(effective.port) !== String(expected.port) ||
      effective.database !== expected.database || effective.user !== expected.user || effective.password !== decodeURIComponent(url.password) || effective.options) {
    throw new Error("Disposable database effective target differs from its admitted URL");
  }
  return url.toString();
}
