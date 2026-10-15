import { createServer } from "node:http";
import { handleSamlApiRequest, type SamlApiDeps } from "./samlApi";
import type { SamlRequestStore } from "./samlRequestStore";
import { generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignedXml } from "xml-crypto";

/** Fresh test-only IdP material; never persist a signing key in source or logs.
 * OpenSSL is the existing owned-certificate test prerequisite. Setup failure
 * aborts the tests rather than substituting a static key or skipping signing.
 */
function createTestIdpKeypair(): { privateKey: string; certificate: string } {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const directory = mkdtempSync(join(tmpdir(), "coop-saml-test-idp-"));
  try {
    const keyFile = join(directory, "idp.key");
    writeFileSync(keyFile, pem, { mode: 0o600 });
    const generated = spawnSync("openssl", [
      "req", "-new", "-x509", "-key", keyFile,
      "-subj", "/CN=Coop disposable SAML test IdP", "-days", "2", "-sha256"
    ], { encoding: "utf8", timeout: 15_000, maxBuffer: 65_536 });
    if (generated.error || generated.status !== 0) {
      // Do not expose subprocess output or private material in setup errors.
      throw new Error("OpenSSL failed to generate the disposable SAML test certificate");
    }
    const certificate = generated.stdout;
    if (!new X509Certificate(certificate).checkPrivateKey(privateKey)) {
      throw new Error("Disposable SAML test certificate does not match its signing key");
    }
    return { privateKey: pem, certificate };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export const { privateKey: TEST_IDP_PRIVATE_KEY, certificate: TEST_IDP_CERT } = createTestIdpKeypair();

export const TEST_SAML_BASE_URL = "https://api.coop-ai.dev";
export const TEST_IDP_ENTITY_ID = "https://saml.example.com/entityid";
export const TEST_IDP_SSO_URL = "https://mocksaml.com/api/saml/sso";

export type SignedSamlResponseOptions = {
  email?: string;
  spEntityId?: string;
  acsUrl?: string;
  idpEntityId?: string;
  requestId?: string;
  subjectRequestId?: string;
  notOnOrAfter?: string;
  omitSubjectRequestId?: boolean;
  signingPrivateKey?: string;
};

/** Build a base64 SAMLResponse signed with the test IdP key (matches TEST_IDP_CERT). */
export function createSignedSamlResponse(options: SignedSamlResponseOptions = {}): string {
  const email = options.email ?? "sso-test@demo.local";
  const spEntityId = options.spEntityId ?? `${TEST_SAML_BASE_URL}/v1/auth/saml/metadata`;
  const acsUrl = options.acsUrl ?? `${TEST_SAML_BASE_URL}/v1/auth/saml/callback`;
  const idpEntityId = options.idpEntityId ?? TEST_IDP_ENTITY_ID;

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = options.notOnOrAfter ?? new Date(now.getTime() + 3_600_000).toISOString();
  const responseCorrelation = options.requestId ? ` InResponseTo="${options.requestId}"` : "";
  const subjectId = options.subjectRequestId ?? options.requestId;
  const subjectCorrelation = subjectId && !options.omitSubjectRequestId ? ` InResponseTo="${subjectId}"` : "";
  const assertionId = `_assertion_${randomBytes(8).toString("hex")}`;
  const responseId = `_response_${randomBytes(8).toString("hex")}`;

  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">
  <saml:Issuer>${idpEntityId}</saml:Issuer>
  <saml:Subject>
    <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${acsUrl}"${subjectCorrelation}/>
    </saml:SubjectConfirmation>
  </saml:Subject>
  <saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">
    <saml:AudienceRestriction>
      <saml:Audience>${spEntityId}</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="session-test-123">
    <saml:AuthnContext>
      <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
    </saml:AuthnContext>
  </saml:AuthnStatement>
  <saml:AttributeStatement>
    <saml:Attribute Name="email">
      <saml:AttributeValue>${email}</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>
</saml:Assertion>`;

  const sig = new SignedXml({
    privateKey: options.signingPrivateKey ?? TEST_IDP_PRIVATE_KEY,
    publicCert: TEST_IDP_CERT,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#"
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#"
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256"
  });
  sig.computeSignature(assertion, {
    location: { reference: "//*[local-name(.)='Issuer']", action: "after" }
  });
  const signedAssertion = sig.getSignedXml();

  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${acsUrl}"${responseCorrelation}>
  <saml:Issuer>${idpEntityId}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  ${signedAssertion}
</samlp:Response>`;

  return Buffer.from(response, "utf8").toString("base64");
}


/** Test-only store: deterministic fast controls do not qualify replica persistence. */
export class MemorySamlRequestStore implements SamlRequestStore {
  public readonly entries = new Map<string, import("./samlRequestStore").SamlLoginRequest>();
  public async save(state: import("./samlRequestStore").SamlLoginRequest): Promise<void> {
    this.entries.set(state.relayHash, { ...state });
  }
  public async find(hash: string): Promise<import("./samlRequestStore").SamlLoginRequest | undefined> {
    const state = this.entries.get(hash); return state && { ...state };
  }
  public async bind(hash: string, browserHash: string): Promise<boolean> {
    const state = this.entries.get(hash);
    if (!state || state.browserHash) return false;
    state.browserHash = browserHash; return true;
  }
  public async accept<T>(state: import("./samlRequestStore").SamlLoginRequest,
    work: (client?: import("pg").PoolClient) => Promise<T>): Promise<T> {
    if (!this.entries.delete(state.relayHash)) throw new Error("SAML state already consumed");
    return work();
  }
}

export async function startSamlHttpServer(deps: SamlApiDeps) {
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const url = new URL(request.url!, "http://localhost");
      await handleSamlApiRequest({ method: request.method!, pathname: url.pathname, query: url.searchParams,
        headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) =>
          [key, Array.isArray(value) ? value.join(",") : value])), body: request.headers["content-type"]?.startsWith("application/json")
          ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
        rawBody: Buffer.concat(chunks).toString() }, response, deps);
    } catch { response.writeHead(500); response.end("fixture request failed"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())) };
}
