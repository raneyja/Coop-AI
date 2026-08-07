export type HighlightTokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "property";

export type HighlightToken = {
  text: string;
  kind: HighlightTokenKind;
};

type HighlightFamily = "javascript" | "python" | "json" | "hash-comment" | "slash-comment" | "text";

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
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "package",
  "private",
  "protected",
  "public",
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
  "False",
  "None",
  "True",
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
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield"
] as const;

const JSON_KEYWORDS = ["true", "false", "null"] as const;

/** Shared keywords across Go / Rust / Java / C-family / Ruby / PHP / Kotlin / Swift / Scala. */
const C_LIKE_KEYWORDS = [
  "abstract",
  "as",
  "async",
  "await",
  "base",
  "bool",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "chan",
  "char",
  "class",
  "const",
  "continue",
  "crate",
  "debugger",
  "default",
  "defer",
  "def",
  "del",
  "do",
  "double",
  "else",
  "enum",
  "except",
  "export",
  "extends",
  "extern",
  "false",
  "False",
  "final",
  "finally",
  "float",
  "fn",
  "for",
  "foreach",
  "from",
  "func",
  "function",
  "go",
  "goto",
  "if",
  "impl",
  "implements",
  "import",
  "in",
  "inline",
  "instanceof",
  "int",
  "interface",
  "internal",
  "let",
  "long",
  "match",
  "mod",
  "module",
  "mut",
  "namespace",
  "new",
  "nil",
  "None",
  "null",
  "object",
  "operator",
  "override",
  "package",
  "private",
  "protected",
  "pub",
  "public",
  "raise",
  "return",
  "self",
  "sizeof",
  "static",
  "struct",
  "super",
  "switch",
  "this",
  "throw",
  "trait",
  "true",
  "True",
  "try",
  "type",
  "typedef",
  "typeof",
  "unsafe",
  "use",
  "using",
  "var",
  "virtual",
  "void",
  "volatile",
  "where",
  "while",
  "with",
  "yield"
] as const;

function normalizeFamily(language?: string): HighlightFamily {
  if (!language) {
    return "text";
  }
  const normalized = language.trim().toLowerCase();
  if (["js", "jsx", "javascript", "mjs", "cjs", "ts", "tsx", "typescript", "node"].includes(normalized)) {
    return "javascript";
  }
  if (["py", "python", "python3"].includes(normalized)) {
    return "python";
  }
  if (["json", "jsonc"].includes(normalized)) {
    return "json";
  }
  if (["rb", "ruby", "pyi"].includes(normalized)) {
    return "hash-comment";
  }
  if (
    [
      "go",
      "golang",
      "rs",
      "rust",
      "java",
      "kt",
      "kotlin",
      "kts",
      "swift",
      "cs",
      "csharp",
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp",
      "php",
      "scala",
      "sc"
    ].includes(normalized)
  ) {
    return "slash-comment";
  }
  // Unknown source-looking tags still get C-like coloring rather than monochrome.
  if (/^[a-z][a-z0-9#+_-]*$/i.test(normalized) && !["text", "plaintext", "markdown", "md"].includes(normalized)) {
    return "slash-comment";
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

function highlightWithKeywords(
  code: string,
  keywords: readonly string[],
  style: "slash" | "hash"
): HighlightToken[] {
  const keywordSet = new Set(keywords);
  const keywordPattern = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const commentParts =
    style === "slash"
      ? [String.raw`\/\/.*$`, String.raw`\/\*[\s\S]*?\*\/`]
      : [String.raw`#.*$`];
  const matcher = new RegExp(
    [
      ...commentParts,
      String.raw`"(?:\\.|[^"\\])*"`,
      String.raw`'(?:\\.|[^'\\])*'`,
      "`(?:\\\\.|[^`\\\\])*`",
      String.raw`\b(?:${keywordPattern})\b`,
      String.raw`\b\d+(?:\.\d+)?\b`
    ].join("|"),
    "gm"
  );
  return tokenizeWithRegex(code, matcher, (token) => {
    if (token.startsWith("//") || token.startsWith("/*") || token.startsWith("#")) {
      return "comment";
    }
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      return "string";
    }
    if (keywordSet.has(token)) {
      return "keyword";
    }
    if (/^\d/.test(token)) {
      return "number";
    }
    return "plain";
  });
}

export function lightHighlight(code: string, language?: string): HighlightToken[] {
  if (!code) {
    return [];
  }

  const family = normalizeFamily(language);

  if (family === "javascript") {
    return highlightWithKeywords(code, JS_KEYWORDS, "slash");
  }
  if (family === "python") {
    return highlightWithKeywords(code, PYTHON_KEYWORDS, "hash");
  }
  if (family === "hash-comment") {
    return highlightWithKeywords(code, [...PYTHON_KEYWORDS, ...C_LIKE_KEYWORDS], "hash");
  }
  if (family === "slash-comment") {
    return highlightWithKeywords(code, [...JS_KEYWORDS, ...C_LIKE_KEYWORDS], "slash");
  }
  if (family === "json") {
    const keywordSet = new Set(JSON_KEYWORDS);
    const matcher =
      /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gm;
    return tokenizeWithRegex(code, matcher, (token) => {
      if (token.startsWith('"') && token.endsWith('"')) {
        // Keys matched with (?=\s*:) and values are both quoted — treat as string;
        // property tint when followed by colon is approximate via property class unused here.
        return "string";
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

  // Last resort: still color strings/comments/numbers so blocks never look like plain markdown.
  return highlightWithKeywords(code, [...JS_KEYWORDS, ...C_LIKE_KEYWORDS, ...PYTHON_KEYWORDS], "slash");
}
