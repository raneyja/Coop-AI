import type { Pool, PoolClient, QueryConfig, ClientConfig } from "pg";
import { hashApiKey } from "./credentialCrypto";
import { INTEGRATION_OPERATION_ARITY, type IntegrationOperation } from "../api/integrations/integrationOperations";
import { resolveAuthContextDetailed, authUserId, extractBearerToken } from "./authMiddleware";
import type { UserStore } from "./users/userStore";
import { executeIntegrationOperation, IntegrationOperationError, operationProvider } from "./integrationOperations";
import { resolveActorIntegrationScope } from "./resolveIntegrationScope";
import type { ServerResponse } from "node:http";
import type { AuthContext } from "./orgStore";
import type { IntegrationConnectionRecord, IntegrationConnectionStore, IntegrationProvider } from "./integrationConnectionStore";
import type { IntegrationScopePolicyStore, IntegrationScopePolicyRecord } from "./integrationScopePolicyStore";
import type { OrgStore } from "./orgStore";
import type { AtlassianAppService } from "./atlassianAppService";
import type { NotionAppService } from "./notionAppService";
import type { GoogleDocsAppService } from "./googleDocsAppService";
import type { SlackAppService } from "./slackAppService";
import type { TeamsAppService } from "./teamsAppService";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const CREDENTIAL_PROVIDERS: IntegrationProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
];

export type IntegrationApiDeps = {
  /** Actual factory pool: final publication uses one durable transaction client. */
  pool?: Pool;
  integrationStore?: IntegrationConnectionStore;
  scopePolicyStore?: IntegrationScopePolicyStore;
  orgStore?: OrgStore;
  userStore?: UserStore;
  atlassianApp?: AtlassianAppService;
  notionApp?: NotionAppService;
  googleDocsApp?: GoogleDocsAppService;
  teamsApp?: TeamsAppService;
  slackApp?: SlackAppService;
};

type ParsedRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
};

export async function handleIntegrationApiRequest(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: IntegrationApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/integrations/credentials") {
    return handleIntegrationCredentials(parsed, response, deps, auth);
  }
  if (parsed.method === "POST" && parsed.pathname === "/v1/orgs/integrations/operate") {
    return handleIntegrationOperation(parsed, response, deps, auth);
  }
  if (parsed.method === "GET" && parsed.pathname === "/v1/orgs/integrations/scope") {
    return handleIntegrationScope(parsed, response, deps, auth);
  }
  return false;
}

async function handleIntegrationCredentials(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: IntegrationApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }
  writeJson(response, 410, { error: "integration_client_upgrade_required", message: "Update Coop to use authorized integration search and reads." });
  return true;
}

async function handleIntegrationOperation(
  parsed: ParsedRequest, response: ServerResponse, deps: IntegrationApiDeps, auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") { writeJson(response, 401, { error: "unauthorized" }); return true; }
  if (!deps.pool || !deps.orgStore || !deps.integrationStore || !deps.scopePolicyStore) {
    writeJson(response, 503, { error: "integration authorization unavailable" }); return true;
  }
  const body = parsed.body as { operation?: unknown; args?: unknown } | null;
  if (!body || typeof body.operation !== "string" || body.operation.length > 80 || !Array.isArray(body.args) ||
      JSON.stringify(body).length > 8000 || Object.keys(body).some(key => key !== "operation" && key !== "args")) {
    writeJson(response, 400, { error: "invalid integration request" }); return true;
  }
  const arity = Object.prototype.hasOwnProperty.call(INTEGRATION_OPERATION_ARITY, body.operation) ? INTEGRATION_OPERATION_ARITY[body.operation as IntegrationOperation] : undefined;
  if (!arity || body.args.length < arity[0] || body.args.length > arity[1]) { writeJson(response, 400, { error: "invalid integration operation or arguments" }); return true; }
  const provider = operationProvider(body.operation);
  if (!provider) { writeJson(response, 400, { error: "unsupported integration operation" }); return true; }
  const controller = new AbortController();
  const onClose = () => { if (!response.writableEnded) controller.abort(); };
  response.once("close", onClose);
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const initialAuth = await resolveAuthContextDetailed(parsed.headers, deps.orgStore, undefined, true, deps.userStore);
    if (!initialAuth.auth || initialAuth.orgSuspended || initialAuth.auth.orgId !== auth.orgId || authUserId(initialAuth.auth) !== authUserId(auth)) {
      throw new IntegrationOperationError(403, "Integration actor is not authorized.");
    }
    const org = await deps.orgStore.getOrganization(auth.orgId);
    if (!org) throw new IntegrationOperationError(403, "Integration organization is not authorized.");
    const initialConnection = await deps.integrationStore.get(auth.orgId, provider);
    if (!initialConnection) throw new IntegrationOperationError(404, "Integration is not connected.");
    const policy = await deps.scopePolicyStore.get(auth.orgId, provider);
    const scope = await resolveActorIntegrationScope({ orgId: auth.orgId, provider, connected: true,
      scopePolicyStore: { get: async () => policy }, principal: authUserId(auth) });
    if (!scope.allowed) throw new IntegrationOperationError(403, "Integration source policy is required or denies this actor.");
    const credential = await resolveAccessToken(auth.orgId, provider, deps);
    if (!credential) throw new IntegrationOperationError(503, "Integration sign-in is unavailable. Reconnect the integration.");
    const { accessToken, connection } = credential;
    if (JSON.stringify(connection.metadata) !== JSON.stringify(initialConnection.metadata)) {
      throw new IntegrationOperationError(403, "Integration connection changed. Retry the request.");
    }
    const access = (policy?.policy as { access?: { directory?: boolean } } | undefined)?.access;
    const result = await executeIntegrationOperation({ operation: body.operation, args: body.args, accessToken,
      connection, scope, directoryAccess: access?.directory === true, signal: controller.signal });
    const serialized = JSON.stringify({ result });
    if (serialized.length > 256000 || serialized.includes(accessToken)) throw new IntegrationOperationError(502, "Integration response could not be admitted.");
    await publishAuthorizedIntegration(parsed, response, deps, { auth: initialAuth.auth, plan: org.plan,
      provider, connection, policy }, serialized, controller.signal);
  } catch (error) {
    if (!response.destroyed && !response.headersSent) writeJson(response, error instanceof IntegrationOperationError ? error.status : 502,
      { error: error instanceof IntegrationOperationError ? error.message : "Integration request failed. Retry or reconnect the integration." });
  } finally {
    clearTimeout(timeout);
    response.removeListener("close", onClose);
  }
  return true;
}

async function handleIntegrationScope(
  parsed: ParsedRequest,
  response: ServerResponse,
  deps: IntegrationApiDeps,
  auth?: AuthContext
): Promise<boolean> {
  if (!auth || auth.orgId === "legacy") {
    writeJson(response, 401, { error: "unauthorized" });
    return true;
  }

  const provider = parsed.query.get("provider") as IntegrationProvider | null;
  if (!provider || !CREDENTIAL_PROVIDERS.includes(provider)) {
    writeJson(response, 400, { error: "invalid provider" });
    return true;
  }

  if (!deps.pool || !deps.orgStore || !deps.integrationStore || !deps.scopePolicyStore) {
    writeJson(response, 503, { error: "integration authorization unavailable" }); return true;
  }
  try {
    const initialAuth = await resolveAuthContextDetailed(parsed.headers, deps.orgStore, undefined, true, deps.userStore);
    if (!initialAuth.auth || initialAuth.orgSuspended || initialAuth.auth.orgId !== auth.orgId || authUserId(initialAuth.auth) !== authUserId(auth)) {
      throw new IntegrationOperationError(403, "Integration actor is not authorized.");
    }
    const org = await deps.orgStore.getOrganization(auth.orgId);
    if (!org) throw new IntegrationOperationError(403, "Integration organization is not authorized.");
    const connection = await deps.integrationStore.get(auth.orgId, provider);
    const policy = await deps.scopePolicyStore.get(auth.orgId, provider);
    const resolved = await resolveActorIntegrationScope({ orgId: auth.orgId, provider,
      connected: Boolean(connection), scopePolicyStore: { get: async () => policy }, principal: authUserId(auth) });
    const serialized = JSON.stringify(resolved);
    if (serialized.length > 256000) throw new IntegrationOperationError(502, "Integration response could not be admitted.");
    await publishAuthorizedIntegration(parsed, response, deps, { auth: initialAuth.auth, plan: org.plan,
      provider, connection, policy }, serialized);
  } catch (error) {
    if (!response.destroyed && !response.headersSent) writeJson(response, error instanceof IntegrationOperationError ? error.status : 502,
      { error: error instanceof IntegrationOperationError ? error.message : "Integration scope is unavailable. Retry the request." });
  }
  return true;
}

/** Publication is a synchronous response write under actual mutation-row locks.
 * Vendor work and response serialization finish before acquiring this client. */
async function publishAuthorizedIntegration(
  parsed: ParsedRequest, response: ServerResponse, deps: IntegrationApiDeps,
  captured: { auth: AuthContext; plan: string; provider: IntegrationProvider;
    connection?: IntegrationConnectionRecord; policy?: IntegrationScopePolicyRecord },
  serialized: string, signal?: AbortSignal
): Promise<void> {
  const unavailable = () => new IntegrationOperationError(503, "Integration publication is unavailable. Retry the request.");
  const changed = () => new IntegrationOperationError(403, "Integration authorization changed. Retry the request.");
  const token = extractBearerToken(parsed.headers);
  if (!deps.pool || !deps.orgStore || !deps.integrationStore || !deps.scopePolicyStore || !token ||
      (captured.auth.userId && !deps.userStore)) throw unavailable();
  let client: PoolClient | undefined;
  let released = false, abandoned = false;
  const release = (destroy = false) => {
    if (client && !released) { released = true; client.release(destroy); }
  };
  let rejectWait!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
  const abort = () => { abandoned = true; release(true); rejectWait(unavailable()); };
  const onClose = () => { if (!response.writableEnded) abort(); };
  // This bounds checkout and the entire final transaction, including a dead peer.
  const deadline = Date.now() + 1500;
  const timer = setTimeout(abort, 1500);
  response.once("close", onClose);
  signal?.addEventListener("abort", abort, { once: true });
  const boundedQuery = (text: string, timeout = 1000) => {
    // pg supports per-query read timeout; its QueryConfig typings omit this
    // documented ClientConfig option, so retain both explicit typed contracts.
    const config: QueryConfig & Pick<ClientConfig, "query_timeout"> = { text, query_timeout: timeout };
    return client!.query(config);
  };
  const checkOpen = () => {
    if (abandoned || released || signal?.aborted || response.destroyed || response.writableEnded || Date.now() >= deadline) throw unavailable();
  };
  try {
    if (signal?.aborted || response.destroyed) throw unavailable();
    const checkout = deps.pool.connect().then(acquired => {
      if (abandoned) { acquired.release(); throw unavailable(); }
      return acquired;
    });
    client = await Promise.race([checkout, cancelled]);
    checkOpen();
    await boundedQuery("BEGIN");
    await boundedQuery("SET LOCAL statement_timeout='1000ms'; SET LOCAL lock_timeout='750ms'; SET LOCAL idle_in_transaction_session_timeout='1500ms'");
    // FOR UPDATE also blocks FK key-share for insertion of absent child rows.
    // Existing child UPDATE/DELETE paths additionally conflict with their row locks.
    const org = await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [captured.auth.orgId]);
    if (org.rowCount !== 1) throw changed();
    let expiresAt: number | undefined;
    if (captured.auth.userId) {
      const user = await client.query("SELECT id FROM users WHERE id=$1 AND org_id=$2 FOR SHARE", [captured.auth.userId, captured.auth.orgId]);
      if (user.rowCount !== 1) throw changed();
      const session = await client.query("SELECT expires_at, auth_provider FROM user_sessions WHERE token_hash=$1 AND user_id=$2 AND org_id=$3 FOR UPDATE",
        [hashApiKey(token), captured.auth.userId, captured.auth.orgId]);
      if (session.rowCount !== 1) throw changed();
      expiresAt = new Date(session.rows[0].expires_at).getTime();
      if (!Number.isFinite(expiresAt)) throw changed();
    } else {
      // Same normalization as the existing org-key authentication owner.
      const normalized = token.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
      const key = await client.query("SELECT id FROM api_keys WHERE id=$1 AND org_id=$2 AND key_hash=$3 FOR UPDATE",
        [captured.auth.apiKeyId, captured.auth.orgId, hashApiKey(normalized)]);
      if (key.rowCount !== 1) throw changed();
    }
    await client.query("SELECT org_id FROM org_sso_config WHERE org_id=$1 FOR SHARE", [captured.auth.orgId]);
    const policy = await client.query("SELECT require_sso, allow_password, allow_google FROM org_auth_policy WHERE org_id=$1 FOR SHARE", [captured.auth.orgId]);
    await client.query("SELECT org_id FROM org_integration_connections WHERE org_id=$1 AND provider=$2 FOR SHARE", [captured.auth.orgId, captured.provider]);
    await client.query("SELECT org_id FROM org_integration_policies WHERE org_id=$1 AND provider=$2 FOR SHARE", [captured.auth.orgId, captured.provider]);
    const orgStore = deps.orgStore.inTransaction(client);
    const userStore = deps.userStore?.inTransaction(client);
    const currentAuth = await resolveAuthContextDetailed(parsed.headers, orgStore, undefined, true, userStore);
    const currentConnection = await deps.integrationStore.inTransaction(client).get(captured.auth.orgId, captured.provider);
    const currentPolicy = await deps.scopePolicyStore.inTransaction(client).get(captured.auth.orgId, captured.provider);
    const currentOrg = await orgStore.getOrganization(captured.auth.orgId);
    const auth = currentAuth.auth;
    const signInPolicy = policy.rows[0];
    if (!auth || currentAuth.orgSuspended || auth.orgId !== captured.auth.orgId ||
        authUserId(auth) !== authUserId(captured.auth) || auth.role !== captured.auth.role ||
        auth.sessionProvider !== captured.auth.sessionProvider || !currentOrg || currentOrg.plan !== captured.plan ||
        JSON.stringify(currentConnection) !== JSON.stringify(captured.connection) ||
        JSON.stringify(currentPolicy) !== JSON.stringify(captured.policy) ||
        (auth.userId && signInPolicy && auth.sessionProvider !== "saml" &&
          (signInPolicy.require_sso || (auth.sessionProvider === "password" && !signInPolicy.allow_password) ||
            (auth.sessionProvider === "google" && !signInPolicy.allow_google)))) throw changed();
    checkOpen();
    // Current wall time AFTER every possible lock wait; no await before write.
    if (expiresAt !== undefined && expiresAt <= Date.now()) throw changed();
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(serialized);
    await client.query("COMMIT");
  } catch (error) {
    if (client && !released) {
      try { await boundedQuery("ROLLBACK", 250); }
      catch { release(true); }
    }
    throw error instanceof IntegrationOperationError ? error : unavailable();
  } finally {
    abandoned = true;
    clearTimeout(timer);
    response.removeListener("close", onClose);
    signal?.removeEventListener("abort", abort);
    release();
  }
}

/** Token bytes and their exact durable generation travel together to publication. */
type ResolvedIntegrationCredential = { accessToken: string; connection: IntegrationConnectionRecord };

async function resolveAccessToken(
  orgId: string,
  provider: IntegrationProvider,
  deps: IntegrationApiDeps
): Promise<ResolvedIntegrationCredential | undefined> {
  const store = deps.integrationStore!;
  const connection = await store.get(orgId, provider);
  if (!connection) return undefined;
  const expiresAt = connection.tokenExpiresAt?.getTime();
  const stillValid = expiresAt === undefined || (Number.isFinite(expiresAt) && expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS);
  if (stillValid) {
    const accessToken = await store.getAccessToken(orgId, provider, connection.revision);
    if (accessToken) return { accessToken, connection };
  }
  const refreshToken = await store.getRefreshToken(orgId, provider, connection.revision);
  if (!refreshToken) return undefined;
  const app = provider === "atlassian" ? deps.atlassianApp : provider === "notion" ? deps.notionApp :
    provider === "google-docs" ? deps.googleDocsApp : provider === "teams" ? deps.teamsApp : deps.slackApp;
  if (!app) return undefined;
  try {
    const refreshed: { accessToken: string; refreshToken?: string; expiresAt?: Date } = await app.refreshAccessToken(refreshToken);
    const saved = await store.saveRefreshedTokens(orgId, provider, connection.revision, refreshed.accessToken, {
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt
    });
    if (!saved) return undefined;
    // Refresh advances the generation. Retrieve actual stored bytes at a newly
    // captured generation, never attach a reload's revision to the vendor response.
    const current = await store.get(orgId, provider);
    if (!current) return undefined;
    const accessToken = await store.getAccessToken(orgId, provider, current.revision);
    return accessToken ? { accessToken, connection: current } : undefined;
  } catch {
    return undefined;
  }
}

/** Used by admin integration health tests — same as internal credential resolution. */
export async function resolveOrgIntegrationAccessToken(
  orgId: string,
  provider: IntegrationProvider,
  deps: IntegrationApiDeps
): Promise<string | undefined> {
  if (!deps.integrationStore) {
    return undefined;
  }
  return (await resolveAccessToken(orgId, provider, deps))?.accessToken;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
