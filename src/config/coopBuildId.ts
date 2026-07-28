/**
 * Support / diagnostics build id (not shown as a product stamp on every answer).
 * Bump when shipping a VSIX users should distinguish from prior installs.
 */
export const COOP_EXTENSION_BUILD_ID = "0.1.0";

export function coopBuildBanner(): string {
  return `CoopAI ${COOP_EXTENSION_BUILD_ID}`;
}
