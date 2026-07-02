import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEY_LEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, expectedHash] = parts;
  if (!salt || !expectedHash) {
    return false;
  }
  const derived = scryptSync(password, salt, SCRYPT_KEY_LEN).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(derived, "hex"));
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string, minLength = 12): string | undefined {
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters.`;
  }
  return undefined;
}
