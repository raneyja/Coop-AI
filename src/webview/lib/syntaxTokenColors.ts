import type { ThemeMode } from "../theme";
import type { HighlightTokenKind } from "./lightHighlight";

/** Dark+ / Light+ syntax colors. Do not use VS Code debug CSS vars — they often equal foreground. */
const SYNTAX_COLORS: Record<ThemeMode, Record<Exclude<HighlightTokenKind, "plain">, string>> = {
  dark: {
    comment: "#6a9955",
    string: "#ce9178",
    number: "#b5cea8",
    keyword: "#569cd6",
    type: "#4ec9b0",
    function: "#dcdcaa",
    property: "#9cdcfe"
  },
  light: {
    comment: "#008000",
    string: "#a31515",
    number: "#098658",
    keyword: "#0000ff",
    type: "#267f99",
    function: "#795e26",
    property: "#001080"
  },
  "high-contrast": {
    comment: "#7ca668",
    string: "#f9ee98",
    number: "#b5cea8",
    keyword: "#569cd6",
    type: "#4ec9b0",
    function: "#dcdcaa",
    property: "#9cdcfe"
  }
};

export function syntaxTokenColor(
  kind: HighlightTokenKind,
  theme: ThemeMode
): string | undefined {
  if (kind === "plain") {
    return undefined;
  }
  return SYNTAX_COLORS[theme][kind];
}
