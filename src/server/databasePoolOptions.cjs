// Shared by the backend and migration CLI; URL SSL options otherwise override pg's ssl object.
const { checkServerIdentity } = require("node:tls");
const { parse } = require("pg-connection-string");

module.exports = function databasePoolOptions(connectionString, env = process.env) {
  let url;
  try {
    url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  } catch {
    // URL errors contain enumerable .input with the entire credential-bearing DSN.
    // Do not retain that error as input, cause or a property of the public error.
    throw new Error("Invalid database connection URL");
  }
  const mode = url.searchParams.get("sslmode") ?? env.PGSSLMODE;
  if (url.searchParams.get("uselibpqcompat") === "true" || mode === "no-verify" || url.searchParams.get("ssl") === "no-verify") {
    throw new Error("Unverified database TLS is unsupported");
  }
  if (mode && !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(mode)) throw new Error("Unsupported database SSL mode");
  if (env.DATABASE_SSL === "true" && (mode === "disable" || ["false", "0"].includes(url.searchParams.get("ssl")))) throw new Error("Conflicting database TLS settings");
  // Let installed pg load certificate/key files before removing URL overrides.
  const parseUrl = new URL(url);
  if (mode && mode !== "disable") parseUrl.searchParams.set("sslmode", "verify-full");
  let parsed;
  try { parsed = parse(parseUrl.toString()); }
  catch { throw new Error("Invalid database URL or TLS certificate configuration"); }
  const useTls = env.DATABASE_SSL === "true" || (mode && mode !== "disable") || !!parsed.ssl;
  const ssl = useTls ? { ...(typeof parsed.ssl === "object" ? parsed.ssl : {}), rejectUnauthorized: true } : false;
  if (ssl) {
    if (!parsed.host) throw new Error("Verified database TLS requires an explicit host");
    // pg omits servername for IP connections; bind identity to the actual target
    // rather than allowing tls.connect's default host to become localhost.
    ssl.checkServerIdentity = (_hostname, certificate) => checkServerIdentity(parsed.host, certificate);
  }
  for (const key of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl };
};
