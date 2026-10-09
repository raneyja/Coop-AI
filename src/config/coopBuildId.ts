/**
 * Support / diagnostics build id (not shown as a product stamp on every answer).
 * Bump when shipping a VSIX users should distinguish from prior installs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const COOP_EXTENSION_BUILD_ID = "0.1.12";
/** Capture once at module load, before a rebuild can replace the running bundle. */
export const COOP_EXTENSION_BUNDLE_ID = (() => {
  try {
    return createHash("sha256").update(readFileSync(__filename)).digest("hex");
  } catch {
    return "unavailable";
  }
})();

export function coopBuildBanner(): string {
  return `CoopAI ${COOP_EXTENSION_BUILD_ID}`;
}
