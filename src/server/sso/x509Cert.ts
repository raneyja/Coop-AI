/** Normalize IdP signing certificates for @node-saml/node-saml (PEM or base64 DER). */
export function normalizeX509Cert(raw: string): string {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (!trimmed) {
    return "";
  }

  if (trimmed.includes("-----BEGIN CERTIFICATE-----")) {
    const body = trimmed
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
    if (!body) {
      return "";
    }
    const lines = body.match(/.{1,64}/g) ?? [body];
    return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
  }

  const base64 = trimmed.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(base64) && base64.length >= 100) {
    const lines = base64.match(/.{1,64}/g) ?? [base64];
    return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
  }

  return trimmed;
}

export function isValidX509Cert(raw: string): boolean {
  const normalized = normalizeX509Cert(raw);
  if (!normalized.includes("-----BEGIN CERTIFICATE-----")) {
    return false;
  }
  if (/^coop_(sess|refresh)_/i.test(raw.trim())) {
    return false;
  }
  const body = normalized
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return body.length >= 100 && /^[A-Za-z0-9+/=]+$/.test(body);
}
