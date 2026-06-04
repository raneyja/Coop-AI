import {
  SAML,
  ValidateInResponseTo,
  generateServiceProviderMetadata,
  type Profile,
  type SamlConfig
} from "@node-saml/node-saml";
import type { OrgSsoConfig } from "./ssoConfigStore";

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
  /** Public base URL of the backend, e.g. https://api.coopai.dev */
  baseUrl: string;
  /** SP entityId advertised in metadata; defaults to the metadata URL. */
  spEntityId?: string;
  /** Clock skew tolerance for NotBefore/NotOnOrAfter checks. */
  acceptedClockSkewMs?: number;
};

export class SsoConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SsoConfigError";
  }
}

/**
 * SAML 2.0 service provider logic for Enterprise SSO (Okta / Azure AD /
 * generic SAML). Stateless and DB-free: callers pass the org's IdP config in.
 * Signature validation is delegated entirely to @node-saml/node-saml — we do
 * NOT hand-roll any XML signature checking.
 */
export class SamlService {
  private readonly acsUrl: string;
  private readonly spEntityId: string;
  private readonly acceptedClockSkewMs: number;

  public constructor(options: SamlServiceOptions) {
    const base = options.baseUrl.replace(/\/+$/, "");
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
  public async getLoginRedirectUrl(config: OrgSsoConfig, relayState: string): Promise<string> {
    const saml = this.buildSaml(config);
    return saml.getAuthorizeUrlAsync(relayState, undefined, {});
  }

  /**
   * Validate a SAML POST response and extract the user identity. Throws if the
   * assertion signature is invalid, the response is malformed, or no usable
   * subject/email can be derived. The thrown error from node-saml carries the
   * specific reason (signature, audience, timestamp, status).
   */
  public async validateCallback(config: OrgSsoConfig, samlResponse: string): Promise<SamlAssertion> {
    const saml = this.buildSaml(config);
    const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
    if (!profile) {
      throw new SsoConfigError("SAML response did not contain a profile");
    }

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

  private buildSaml(config: OrgSsoConfig): SAML {
    const samlConfig: SamlConfig = {
      // SP identity
      issuer: this.spEntityId,
      callbackUrl: this.acsUrl,
      audience: this.spEntityId,
      // IdP identity + trust anchor (signature validation key)
      entryPoint: config.idpSsoUrl,
      idpCert: config.idpX509Cert.trim(),
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
      // Replay protection disabled — multi-instance backend has no shared InResponseTo cache. Signature + audience + NotBefore/NotOnOrAfter still enforced. Add Redis/PG cache provider to enable.
      validateInResponseTo: ValidateInResponseTo.never
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
