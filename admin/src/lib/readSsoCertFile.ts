/**
 * Read an IdP signing certificate from a local download (Entra .cer, Okta PEM, etc.).
 * Accepts PEM text, bare Base64, or DER binary — returns PEM for the SSO form.
 */
export async function readSsoCertFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 32) {
    throw new Error("That file is too small to be a signing certificate.");
  }

  const asText = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  if (asText.includes("-----BEGIN CERTIFICATE-----")) {
    return asText;
  }

  const compact = asText.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length >= 100) {
    return wrapPem(compact);
  }

  // DER binary (common for Entra "Certificate (Base64)" .cer downloads on macOS).
  return wrapPem(bytesToBase64(bytes));
}

function wrapPem(base64Body: string): string {
  const body = base64Body.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
