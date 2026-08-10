/**
 * Hybrid intent suggest (gpt-4o-mini when phrase match is weak).
 * Universal product switch — not a user setting.
 */
export const INTENT_SUGGEST_MODEL_ENABLED = true;

export function isIntentSuggestModelEnabled(): boolean {
  return INTENT_SUGGEST_MODEL_ENABLED;
}
