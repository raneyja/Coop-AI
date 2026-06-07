export type HighlightTokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "property";

export type HighlightToken = {
  text: string;
  kind: HighlightTokenKind;
};

const JS_KEYWORDS = [
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield"
] as const;

const PYTHON_KEYWORDS = [
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "false",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "none",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "true",
  "try",
  "while",
  "with",
  "yield"
] as const;

const JSON_KEYWORDS = ["true", "false", "null"] as const;

function normalizeLanguage(language?: string): "javascript" | "typescript" | "python" | "json" | "text" {
  if (!language) {
    return "text";
  }
  const normalized = language.trim().toLowerCase();
  if (["js", "jsx", "javascript", "mjs", "cjs"].includes(normalized)) {
    return "javascript";
  }
  if (["ts", "tsx", "typescript"].includes(normalized)) {
    return "typescript";
  }
  if (["py", "python"].includes(normalized)) {
    return "python";
  }
  if (["json", "jsonc"].includes(normalized)) {
    return "json";
  }
  return "text";
}

function tokenizeWithRegex(
  source: string,
  matcher: RegExp,
  classify: (token: string) => HighlightTokenKind
): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(source)) !== null) {
    const [value] = match;
    const start = match.index;
    const end = start + value.length;
    if (start > lastIndex) {
      tokens.push({ text: source.slice(lastIndex, start), kind: "plain" });
    }
    tokens.push({ text: value, kind: classify(value) });
    lastIndex = end;
  }

  if (lastIndex < source.length) {
    tokens.push({ text: source.slice(lastIndex), kind: "plain" });
  }

  return tokens;
}

export function lightHighlight(code: string, language?: string): HighlightToken[] {
  const lang = normalizeLanguage(language);
  if (!code) {
    return [];
  }

  if (lang === "javascript" || lang === "typescript") {
    const keywordSet = new Set(JS_KEYWORDS);
    const keywordPattern = JS_KEYWORDS.join("|");
    const matcher = new RegExp(
      [
        String.raw`\/\/.*$`,
        String.raw`\/\*[\s\S]*?\*\/`,
        String.raw`"(?:\\.|[^"\\])*"`,
        String.raw`'(?:\\.|[^'\\])*'`,
        "`(?:\\\\.|[^`\\\\])*`",
        String.raw`\b(?:${keywordPattern})\b`,
        String.raw`\b\d+(?:\.\d+)?\b`
      ].join("|"),
      "gm"
    );
    return tokenizeWithRegex(code, matcher, (token) => {
      if (token.startsWith("//") || token.startsWith("/*")) {
        return "comment";
      }
      if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
        return "string";
      }
      if (keywordSet.has(token as (typeof JS_KEYWORDS)[number])) {
        return "keyword";
      }
      if (/^\d/.test(token)) {
        return "number";
      }
      return "plain";
    });
  }

  if (lang === "python") {
    const keywordSet = new Set(PYTHON_KEYWORDS);
    const keywordPattern = PYTHON_KEYWORDS.join("|");
    const matcher = new RegExp(
      [
        String.raw`#.*$`,
        String.raw`"(?:\\.|[^"\\])*"`,
        String.raw`'(?:\\.|[^'\\])*'`,
        String.raw`\b(?:${keywordPattern})\b`,
        String.raw`\b\d+(?:\.\d+)?\b`
      ].join("|"),
      "gm"
    );
    return tokenizeWithRegex(code, matcher, (token) => {
      if (token.startsWith("#")) {
        return "comment";
      }
      if (token.startsWith('"') || token.startsWith("'")) {
        return "string";
      }
      if (keywordSet.has(token as (typeof PYTHON_KEYWORDS)[number])) {
        return "keyword";
      }
      if (/^\d/.test(token)) {
        return "number";
      }
      return "plain";
    });
  }

  if (lang === "json") {
    const keywordSet = new Set(JSON_KEYWORDS);
    const matcher = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gm;
    return tokenizeWithRegex(code, matcher, (token) => {
      if (token.startsWith('"') && token.endsWith('"')) {
        return token.endsWith('"') ? "property" : "string";
      }
      if (keywordSet.has(token as (typeof JSON_KEYWORDS)[number])) {
        return "keyword";
      }
      if (/^-?\d/.test(token)) {
        return "number";
      }
      return "plain";
    });
  }

  return [{ text: code, kind: "plain" }];
}
