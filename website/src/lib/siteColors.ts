/** Site-wide text greys darkened ~7% (RGB × 0.93). gray-900 / near-black unchanged. */

export function darkenHex(hex: string, amount = 0.07): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const scale = 1 - amount;
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * scale)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const TAILWIND_GRAY = {
  300: "#d1d5db",
  400: "#9ca3af",
  500: "#6b7280",
  600: "#4b5563",
  700: "#374151",
  800: "#1f2937"
} as const;

export const siteGray = {
  300: darkenHex(TAILWIND_GRAY[300]),
  400: darkenHex(TAILWIND_GRAY[400]),
  500: darkenHex(TAILWIND_GRAY[500]),
  600: darkenHex(TAILWIND_GRAY[600]),
  700: darkenHex(TAILWIND_GRAY[700]),
  800: darkenHex(TAILWIND_GRAY[800])
} as const;

/** Dark VS Code–style mock UI greys (not syntax highlighting colors). */
export const siteDarkUiText = {
  muted: darkenHex("#9d9d9d"),
  lineNumber: darkenHex("#858585"),
  faint: darkenHex("#666666"),
  sublabel: darkenHex("#9ca4ad"),
  body: darkenHex("#e5e5e5"),
  bodyBright: darkenHex("#f3f3f3"),
  plain: darkenHex("#d4d4d4"),
  control: darkenHex("#cccccc")
} as const;
