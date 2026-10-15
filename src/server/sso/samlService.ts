import {
  SAML,
  ValidateInResponseTo,
  generateServiceProviderMetadata,
  type CacheProvider,
  type Profile,
  type SamlConfig
} from "@node-saml/node-saml";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SAML_REQUEST_TTL_MS, type SamlRequestStore, type SamlLoginRequest } from "./samlRequestStore";
import { ssoConfigFingerprint, type OrgSsoConfig } from "./ssoConfigStore";
import { normalizeX509Cert } from "./x509Cert";

/**
 * The verified identity extracted from a signed SAML assertion. Only produced
 * after node-saml has validated the signature against the org's idpCert.
 */
export type SamlAssertion = {
  idpProvider: string;
  idpSubject: string;
  email: string;
  sessionIndex?: string;
};

export type SamlServiceOptions = {
  /** Public base URL of the backend, e.g. https://api.coop-ai.dev */
  baseUrl: string;
  /** SP entityId advertised in metadata; defaults to the metadata URL. */
  spEntityId?: string;
  /** Clock skew tolerance for NotBefore/NotOnOrAfter checks. */
  acceptedClockSkewMs?: number;
  requestStore?: SamlRequestStore;
};

export class SsoConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SsoConfigError";
  }
}

/**
 * SAML 2.0 service provider logic for Enterprise SSO (Okta / Azure AD /
 * generic SAML). Durable request acceptance lives in a shared store.
 * Signature validation is delegated entirely to @node-saml/node-saml — we do
 * NOT hand-roll any XML signature checking.
 */
export class SamlService {
  private readonly acsUrl: string;
  private readonly spEntityId: string;
  private readonly acceptedClockSkewMs: number;
  private readonly baseUrl: string;
  private readonly requestStore?: SamlRequestStore;

  public constructor(options: SamlServiceOptions) {
    const base = options.baseUrl.replace(/\/+$/, "");
    this.baseUrl = base;
    this.requestStore = options.requestStore;
    this.acsUrl = `${base}/v1/auth/saml/callback`;
    this.spEntityId = options.spEntityId ?? `${base}/v1/auth/saml/metadata`;
    this.acceptedClockSkewMs = options.acceptedClockSkewMs ?? 5000;
  }

  /**
   * SP metadata is identical for every tenant (single ACS + entityId); each org
   * configures their IdP to point at this one SP. No private key required —
   * we request signed assertions but do not sign our own AuthnRequests.
   */
  public generateMetadata(): string {
    return generateServiceProviderMetadata({
      issuer: this.spEntityId,
      callbackUrl: this.acsUrl,
      identifierFormat: null,
      wantAssertionsSigned: true
    });
  }

  /** Build the SP-initiated login redirect URL to the org's IdP. */
  public async beginLogin(config: OrgSsoConfig, input: {
    redirect?: string; mode: "login" | "test";
  }): Promise<string> {
    const relayState = randomBytes(32).toString("base64url");
    const cache = validationCache();
    const saml = this.buildSaml(config, cache);
    // Azure may silent-SSO from a browser cookie without a UI challenge unless
    // we also request interactive login on the redirect URL.
    const additionalParams: Record<string, string> | undefined =
      config.provider === "azuread" ? { prompt: "login" } : undefined;
    const authorizeUrl = await saml.getAuthorizeUrlAsync(relayState, undefined, {
      additionalParams
    });
    const saved = cache.entries.entries().next().value as [string, string] | undefined;
    if (!saved) throw new SsoConfigError("SAML request state was not generated");
    await this.requireRequestStore().save({
      requestId: saved[0], requestInstant: saved[1], orgId: config.orgId,
      relayHash: stateHash(relayState), configHash: ssoConfigFingerprint(config), authorizeUrl,
      redirect: input.redirect, mode: input.mode
    });
    return `${this.baseUrl}/v1/auth/saml/continue?RelayState=${relayState}`;
  }

  /** Both the admin proxy and extension first fetch start outside the browser.
   * This browser navigation establishes the cross-site POST cookie on the API host. */
  public async continueLogin(relayState: string): Promise<{ authorizeUrl: string; cookie: string }> {
    if (!isStateToken(relayState)) throw new SsoConfigError("Invalid SAML state");
    const state = await this.requireRequestStore().find(stateHash(relayState));
    if (!state || state.browserHash) throw new SsoConfigError("SAML login state is unavailable");
    const browserToken = randomBytes(32).toString("base64url");
    if (!(await this.requireRequestStore().bind(state.relayHash, stateHash(browserToken)))) {
      throw new SsoConfigError("SAML login state is unavailable");
    }
    return { authorizeUrl: state.authorizeUrl,
      cookie: `${samlCookieName(relayState)}=${browserToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SAML_REQUEST_TTL_MS / 1000}` };
  }

  public async getLoginState(relayState: string, cookieHeader?: string): Promise<SamlLoginRequest | undefined> {
    if (!isStateToken(relayState)) return undefined;
    const cookies = (cookieHeader ?? "").split(";").map(item => item.trim().split("="));
    const tokens = cookies.filter(([name]) => name === samlCookieName(relayState));
    if (tokens.length !== 1 || !isStateToken(tokens[0][1] ?? "")) return undefined;
    const state = await this.requireRequestStore().find(stateHash(relayState));
    if (!state?.browserHash || !timingSafeEqual(Buffer.from(state.browserHash, "hex"),
      Buffer.from(stateHash(tokens[0][1]), "hex"))) return undefined;
    return state;
  }

  /**
   * Validate a SAML POST response and extract the user identity. Throws if the
   * assertion signature is invalid, the response is malformed, or no usable
   * subject/email can be derived. The thrown error from node-saml carries the
   * specific reason (signature, audience, timestamp, status).
   */
  public async validateCallback(config: OrgSsoConfig, samlResponse: string, state: SamlLoginRequest): Promise<SamlAssertion> {
    if (state.orgId !== config.orgId || state.configHash !== ssoConfigFingerprint(config) || !state.browserHash) {
      throw new SsoConfigError("SAML login configuration changed");
    }
    // node-saml removes correlation entries even on errors and before later
    // audience/condition checks. Give each validation a disposable cache;
    // failed assertions must never delete the durable pending login.
    const saml = this.buildSaml(config, validationCache(state));
    const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
    if (!profile) {
      throw new SsoConfigError("SAML response did not contain a profile");
    }
    validateSignedBinding(profile, state.requestId, this.acsUrl, config.idpEntityId);

    const idpSubject = typeof profile.nameID === "string" ? profile.nameID.trim() : "";
    if (!idpSubject) {
      throw new SsoConfigError("SAML assertion is missing a NameID subject");
    }

    const email = extractEmail(profile);
    if (!email) {
      throw new SsoConfigError("SAML assertion did not include an email address");
    }

    return {
      idpProvider: config.provider,
      idpSubject,
      email,
      sessionIndex: typeof profile.sessionIndex === "string" ? profile.sessionIndex : undefined
    };
  }

  public async acceptCallback<T>(config: OrgSsoConfig, response: string, state: SamlLoginRequest,
    work: (assertion: SamlAssertion, client?: import("pg").PoolClient) => Promise<T>): Promise<T> {
    return this.requireRequestStore().accept(state, async client => {
      // Lock waits may outlive the earlier signature/time check. Reuse the
      // actual library on the same frozen response at durable admission.
      const assertion = await this.validateAdmission(config, response, state);
      const result = await work(assertion, client);
      // A DB effect can itself wait. Expiry here rolls all effects back.
      await this.validateAdmission(config, response, state);
      return result;
    });
  }

  private async validateAdmission(config: OrgSsoConfig, response: string, state: SamlLoginRequest): Promise<SamlAssertion> {
    try { return await this.validateCallback(config, response, state); }
    catch { throw new SsoConfigError("SAML response is no longer valid at admission"); }
  }

  private requireRequestStore(): SamlRequestStore {
    if (!this.requestStore) throw new SsoConfigError("Shared SAML request storage is unavailable");
    return this.requestStore;
  }

  private buildSaml(config: OrgSsoConfig, cacheProvider: CacheProvider): SAML {
    const samlConfig: SamlConfig = {
      // SP identity
      issuer: this.spEntityId,
      callbackUrl: this.acsUrl,
      audience: this.spEntityId,
      // IdP identity + trust anchor (signature validation key)
      entryPoint: config.idpSsoUrl,
      idpCert: normalizeX509Cert(config.idpX509Cert),
      idpIssuer: config.idpEntityId,
      // Security posture: require the assertion to be signed and verify it
      // against idpCert. Response-level signing is not required (Okta/Azure
      // sign the assertion by default), but at least the assertion must be.
      wantAssertionsSigned: true,
      // Response-level signing not required — Okta and Azure AD don't sign responses by default. Assertion signing (wantAssertionsSigned: true) is the real trust anchor.
      wantAuthnResponseSigned: false,
      signatureAlgorithm: "sha256",
      digestAlgorithm: "sha256",
      acceptedClockSkewMs: this.acceptedClockSkewMs,
      // Don't pin a NameID format — accept whatever Okta/Azure return.
      identifierFormat: null,
      // Enterprise posture: require interactive IdP authentication on every Coop
      // SSO start — do not silently reuse an existing Okta/Azure browser session.
      forceAuthn: true,
      // Azure also honors prompt=login on the authorize redirect (see getLoginRedirectUrl).
      additionalAuthorizeParams: config.provider === "azuread" ? { prompt: "login" } : {},
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
      maxAssertionAgeMs: SAML_REQUEST_TTL_MS,
      cacheProvider
    };
    return new SAML(samlConfig);
  }
}

const EMAIL_CLAIM_KEYS = [
  "email",
  "mail",
  "urn:oid:0.9.2342.19200300.100.1.3",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "http://schemas.microsoft.com/identity/claims/emailaddress"
];

function extractEmail(profile: Profile): string | undefined {
  for (const key of EMAIL_CLAIM_KEYS) {
    const value = profile[key];
    if (typeof value === "string" && value.includes("@")) {
      return value.trim().toLowerCase();
    }
  }
  // Fall back to NameID when the IdP uses the emailAddress NameID format.
  const format = typeof profile.nameIDFormat === "string" ? profile.nameIDFormat : "";
  if (format.includes("emailAddress") && typeof profile.nameID === "string" && profile.nameID.includes("@")) {
    return profile.nameID.trim().toLowerCase();
  }
  return undefined;
}

function stateHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function isStateToken(value: string): boolean { return /^[A-Za-z0-9_-]{43}$/.test(value); }
export function samlCookieName(relayState: string): string {
  if (!isStateToken(relayState)) throw new SsoConfigError("Invalid SAML state");
  return `__Host-coop_saml_${relayState}`;
}

function validationCache(state?: SamlLoginRequest): CacheProvider & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  if (state) entries.set(state.requestId, state.requestInstant);
  return {
    entries,
    async saveAsync(key, value) {
      if (entries.has(key)) throw new SsoConfigError("Duplicate SAML request ID");
      entries.set(key, value);
      return { value, createdAt: Date.now() };
    },
    async getAsync(key) { return entries.get(key) ?? null; },
    async removeAsync(key) {
      const value = key ? entries.get(key) ?? null : null;
      if (key) entries.delete(key);
      return value;
    }
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function one(value: unknown): Record<string, unknown> {
  return Array.isArray(value) && value.length === 1 ? record(value[0]) : {};
}
/** Only inspect the library's verified assertion representation. The unsigned
 * outer XML and attributes cannot supply correlation, recipient or issuer. */
function validateSignedBinding(profile: Profile, requestId: string, acsUrl: string, issuer: string): void {
  const assertion = record(profile.getAssertion?.().Assertion);
  const signedIssuer = one(assertion.Issuer)._;
  const subject = one(assertion.Subject);
  const confirmation = one(subject.SubjectConfirmation);
  const data = record(one(confirmation.SubjectConfirmationData).$);
  if (signedIssuer !== issuer || profile.issuer !== issuer || profile.inResponseTo !== requestId
    || record(confirmation.$).Method !== "urn:oasis:names:tc:SAML:2.0:cm:bearer"
    || data.InResponseTo !== requestId || data.Recipient !== acsUrl
    || typeof data.NotOnOrAfter !== "string" || !Number.isFinite(Date.parse(data.NotOnOrAfter))
    || !Object.keys(one(assertion.Conditions)).length) {
    throw new SsoConfigError("SAML signed assertion binding is invalid");
  }
}
