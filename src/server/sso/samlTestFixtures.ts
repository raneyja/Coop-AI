import { randomBytes } from "node:crypto";
import { SignedXml } from "xml-crypto";

/** Test-only IdP keypair — never used outside unit/integration tests. */
export const TEST_IDP_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDAyl+8peK7TMgp
AAgW7GpzDlNG9X+3en2/38PCvH9It1sa2UWTejTWRCG4r0e1+Ia3JcVKl9Deun29
2TpxxJarhmhs238r1WROyyNtQbyqCU10VQ1ZxRysLGYIyYHLoo7oHdeD6rxcZpF5
6uHBk9uvARiQ01p39JtHVItW0WEm+Cf0Oh5AqND/AFnbwmV0IQkQqW5PX3FiLZjT
ObwsrS4UW5R35d52q8pOXVzLjIufKrW6fJ7AnIQWiFDGlUDektjBQUvx+MxRlXTT
YrbwnXsaExunk8T1SqIxvIJxIOMuUKcwFpx6ZbudZZVFlSI1TishjS9t2iWiwIWi
0VCIPHFvAgMBAAECggEAGzU0V6pNmkNWyDqB6cJJr50o8Y26DYnS715EAVqa2AdQ
azSYlhycElUhMTBDfZHqaTSCaGmOh7BoCH/8uIuW+/QHDr3Xb7c45cnTYRry5khT
zwQl0zJ3PnExoTHXCIcThfyYKrzZAm1TQJJ+c9RLH6KW9fFuBhnWRDXRSFpaTKZg
QG19oRPKE4TB0c6YY225UTriSppaDMp9JWv9JZiDUx4Sfo611TAbvHaz38f3ChCO
wBlqD2vEMQlGwxDjar/Q4qyMQRM+IKP7NMx7+qgs5im/nArTNa4RloHozn14+CSa
ZRGlg3N460WGMVL3d4Tk8xBL42QzS5wr8UPleSXYoQKBgQDeYRNU/d1AmnHkDc+Z
tW5mvNF4IYjs06uIBHV00RyNptHJjPokKgYbHFy5wvDcehFTuAiJsmhJN5EjIWj0
PilBr15CtKXi+RN2T7cJ2PRfUGrASSBsUMgU9s61/RdBMiQLJO7aECRhy9wPhTg9
q0cxKVmyaN1B/NesRwELfm0IsQKBgQDd8BqF4BTaV3gWIaMhmn2xG/RttbHaaXWH
acqLynSB4YA6AJ1/PGbF2StkG0uyobEmbUneLFnUDNgEiGyxuBlVA9d+/rqI6p7W
8J9WbTYIblPqY/JUOkyZOg6d6hRU6R2QrT2N2b7O2dswekasLAU/VVxX6TlD3Uga
jrgV9KekHwKBgGwcO57FMGw46YeaY0Px3XNa9mb1vrCME0c0C7o38y62XCUlQXKV
b5R8jGPO7vPw8D2IKbZvop19wzSWCIU9Nyd0z1mUo1UeDCUnie/ipqMz4EINCxM9
jpgKiOIW4dhTPQyh7vDaiiV1S03MUVRB0YGH/dBrhK2Q83UQq+RfmThxAoGBAKeu
H6vkOH0atv0pnuHlom9sqok1TNGy+fw8Xq6tYMc8g6/PBS+7h/6VbOYuhUvKRFi/
G59DrP68UX1jQZQofuMviuJFPNPzR90nYYtf6gIGsVoW92DRx0vBhIek8oWQtyi2
6xnAWRxZlvSSfdDZVYGbUbCN4hk3F6IREF5uQTaLAoGBAMTAWBXi1P2V7qD1J/s9
A8JwMJHf8xU50jXt/HLnffLxVnzrIOqGgS/OeyQq8H5s1CF1elGg/C3TbSZh+r7U
bX5tCwUrNG1EkybvYmAnp70LAXOTGARLNeudp0oEbXVohHhbyiVa4DAyXNDyeyqc
J9G8ZFBtaE72yGDRc5+g807n
-----END PRIVATE KEY-----`;

export const TEST_IDP_CERT = `-----BEGIN CERTIFICATE-----
MIICtjCCAZ4CCQD754g9tB4UXTANBgkqhkiG9w0BAQsFADAdMRswGQYDVQQDDBJD
b29wIFNBTUwgVGVzdCBJZFAwHhcNMjYwNzA5MjAxMDEwWhcNMzYwNzA2MjAxMDEw
WjAdMRswGQYDVQQDDBJDb29wIFNBTUwgVGVzdCBJZFAwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDAyl+8peK7TMgpAAgW7GpzDlNG9X+3en2/38PCvH9I
t1sa2UWTejTWRCG4r0e1+Ia3JcVKl9Deun292TpxxJarhmhs238r1WROyyNtQbyq
CU10VQ1ZxRysLGYIyYHLoo7oHdeD6rxcZpF56uHBk9uvARiQ01p39JtHVItW0WEm
+Cf0Oh5AqND/AFnbwmV0IQkQqW5PX3FiLZjTObwsrS4UW5R35d52q8pOXVzLjIuf
KrW6fJ7AnIQWiFDGlUDektjBQUvx+MxRlXTTYrbwnXsaExunk8T1SqIxvIJxIOMu
UKcwFpx6ZbudZZVFlSI1TishjS9t2iWiwIWi0VCIPHFvAgMBAAEwDQYJKoZIhvcN
AQELBQADggEBAGszqrw+AQuTlmArHvpMSU+bRScUgC3dgVnQ8xbEPmaYSSZtRq7z
887QOcX7WcxQXTB8/uePKBdOoHHskBd5V697lwPBvzlQEv3PtEOGr1D5pQCUVaM0
YBOR9+APD2HAt9sFZaMDRf+yYYI1pVa09XTUCxCEKgJQ37NQVcpV9y0M2XuGN0TA
7Prc/Wavba6NqKYVL2FfTbMqoQkIHMHg4EOi6DHXIkCxRHh5zKSHvBOO/1qXKtDl
0pj5YPqQz/5G1/QiEwKtloEvy170j17/fHU6Q+oJ5HDKq0Op8XGnPkuTrKckdh1/
V3boA5HDGZV7u0s9s7rLhd0Z8GtpCalk8GY=
-----END CERTIFICATE-----`;

export const TEST_SAML_BASE_URL = "https://api.coop-ai.dev";
export const TEST_IDP_ENTITY_ID = "https://saml.example.com/entityid";
export const TEST_IDP_SSO_URL = "https://mocksaml.com/api/saml/sso";

export type SignedSamlResponseOptions = {
  email?: string;
  spEntityId?: string;
  acsUrl?: string;
  idpEntityId?: string;
};

/** Build a base64 SAMLResponse signed with the test IdP key (matches TEST_IDP_CERT). */
export function createSignedSamlResponse(options: SignedSamlResponseOptions = {}): string {
  const email = options.email ?? "sso-test@demo.local";
  const spEntityId = options.spEntityId ?? `${TEST_SAML_BASE_URL}/v1/auth/saml/metadata`;
  const acsUrl = options.acsUrl ?? `${TEST_SAML_BASE_URL}/v1/auth/saml/callback`;
  const idpEntityId = options.idpEntityId ?? TEST_IDP_ENTITY_ID;

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + 3_600_000).toISOString();
  const assertionId = `_assertion_${randomBytes(8).toString("hex")}`;
  const responseId = `_response_${randomBytes(8).toString("hex")}`;

  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">
  <saml:Issuer>${idpEntityId}</saml:Issuer>
  <saml:Subject>
    <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${acsUrl}"/>
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
    privateKey: TEST_IDP_PRIVATE_KEY,
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

  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${acsUrl}">
  <saml:Issuer>${idpEntityId}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  ${signedAssertion}
</samlp:Response>`;

  return Buffer.from(response, "utf8").toString("base64");
}
