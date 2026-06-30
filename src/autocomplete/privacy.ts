import * as path from "node:path";
import type { ExtractedCodeContext } from "./types";

const SENSITIVE_FILE_PATTERN =
  /(?:^|\/)(?:\.env(?:\.|$)|\.env\..+|secrets?\.|credentials?\.|id_rsa|\.pem$|\.key$)/i;

const API_KEY_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]{8,})([A-Za-z0-9]{4})\b/g;
const PASSWORD_PATTERN = /(password\s*[:=]\s*)(['"]?)([^'"\s]{3,})\2/gi;
const PII_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

export function isSensitiveFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (SENSITIVE_FILE_PATTERN.test(filePath) || SENSITIVE_FILE_PATTERN.test(base)) {
    return true;
  }
  if (base === ".npmrc" || base === "netrc") {
    return true;
  }
  return false;
}

export function maskSensitiveText(text: string): string {
  let masked = text;
  masked = masked.replace(API_KEY_PATTERN, (_match, _prefix, last4) => `sk_***${last4}`);
  masked = masked.replace(PASSWORD_PATTERN, (_m, label, quote) => `${label}${quote}****${quote}`);
  masked = masked.replace(PII_EMAIL, "[email]");
  return masked;
}

export function shouldSkipForPrivacy(context: ExtractedCodeContext): boolean {
  if (isSensitiveFile(context.filePath)) {
    return true;
  }
  const combined = [
    context.currentLinePrefix,
    context.suffixWindow,
    context.previousLines,
    context.importsBlock
  ].join("\n");
  if (API_KEY_PATTERN.test(combined) || PASSWORD_PATTERN.test(combined)) {
    return true;
  }
  return false;
}

export function sanitizeContextForRequest(context: ExtractedCodeContext): ExtractedCodeContext {
  return {
    ...context,
    currentLinePrefix: maskSensitiveText(context.currentLinePrefix),
    currentLineSuffix: maskSensitiveText(context.currentLineSuffix),
    suffixWindow: maskSensitiveText(context.suffixWindow),
    previousLines: maskSensitiveText(context.previousLines),
    importsBlock: maskSensitiveText(context.importsBlock),
    parentSignature: maskSensitiveText(context.parentSignature)
  };
}

/** Clear in-memory context payloads after use (no disk persistence). */
export function discardContextPayload(_context: ExtractedCodeContext): void {
  // Intentionally empty — callers drop references; no disk cache for autocomplete.
}
