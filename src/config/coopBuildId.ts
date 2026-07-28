/**
 * Unmistakable runtime marker — if Understand Repo / activate do not show this
 * string, the Extension Host is not loading this workspace's dist/extension.js.
 */
export const COOP_EXTENSION_BUILD_ID = "attach-v4-2026-07-28T19:00Z";

export function coopBuildBanner(): string {
  return `Coop build ${COOP_EXTENSION_BUILD_ID}`;
}
