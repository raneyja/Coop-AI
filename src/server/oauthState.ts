import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 60 * 60 * 1000;

export function signOAuthState(orgId: string, stateSecret: string): string {
  const issuedAt = String(Date.now());
  const signature = stateSignature(orgId, issuedAt, stateSecret);
  return `${orgId}.${issuedAt}.${signature}`;
}

export function verifyOAuthState(state: string, stateSecret: string): string | undefined {
  const parts = state.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const [orgId, issuedAt, signature] = parts;
  if (!orgId || !issuedAt || !signature) {
    return undefined;
  }
  const ageMs = Date.now() - Number(issuedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > STATE_TTL_MS) {
    return undefined;
  }
  const expected = stateSignature(orgId, issuedAt, stateSecret);
  if (!safeEqual(signature, expected)) {
    return undefined;
  }
  return orgId;
}

function stateSignature(orgId: string, issuedAt: string, stateSecret: string): string {
  return createHmac("sha256", stateSecret).update(`${orgId}:${issuedAt}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return cryptoTimingSafeEqual(aBuf, bBuf);
}
