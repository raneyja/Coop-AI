import { isRepoStructureQuery } from "../workspace/repoFactIntent";

/**
 * Does this turn need the repository's code, and what does the user want done?
 *
 * One classifier, used by the intent planner and by agent routing. It replaced a
 * ten-word keyword regex that routed on incidental vocabulary: "fix the bug
 * where tokens expire" qualified because it contained "where", while "show me
 * the authentication middleware" did not qualify at all.
 *
 * Repo-agnostic by construction — it knows about code shapes and English verbs,
 * never about a particular project's folders or frameworks.
 */

export type RepoCodeAction = "locate" | "understand" | "change" | "none";

export type RepoCodeIntent = {
  action: RepoCodeAction;
  confidence: "high" | "medium" | "low";
  /** Why it routed this way — for activity copy and debugging. */
  reason: string;
};

const NONE: RepoCodeIntent = { action: "none", confidence: "low", reason: "no repo code intent" };

/** Acknowledgements and small talk. */
const CONVERSATIONAL =
  /^(?:hi|hello|hey(?:\s+there)?|yo|howdy|greetings|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|ty|ok|okay|k|got\s+it|nice|cool|great|perfect|yes|yep|no|nope|sure|sounds\s+good|never\s+mind)\b/i;

/**
 * True when the whole message is small talk ("Thanks"), not "ok now add logging".
 * Prefix-only matching would steal real change asks that start with "ok".
 */
export function isConversationalChat(message: string): boolean {
  return /^(?:hi|hello|hey(?:\s+there)?|yo|howdy|greetings|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|ty|ok(?:ay)?|k|got\s+it|nice|cool|great|perfect|yes|yep|no|nope|sure|sounds\s+good|never\s+mind)(?:\s+thanks?)?(?:\s+that(?:'s|\s+is)?\s+worked)?[.!?]*$/i.test(
    message.trim()
  );
}

/** "explain this function" — the open buffer, not the repository. */
const LOCAL_SCOPE =
  /\bthis\s+(function|method|class|file|code|selection|snippet|line|block|component)\b/i;

/** A concrete code entity the user typed: identifier, path, or backticked token. */
const IDENTIFIER =
  /\b(?:[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/;
const FILE_PATH = /(?:^|\s)[\w.-]+\/[\w./-]+|\.\w{1,4}\b(?:\s|$)/;
const BACKTICKED = /`[^`]+`/;

/** A path the user typed, e.g. `src/server/authMiddleware.ts` — always a repo reference. */
const NAMED_SOURCE_FILE =
  /(?:^|\s)(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|md|json|yml|yaml)\b/i;

/** Words that name a role in a system rather than a specific product. */
const ROLE_NOUN =
  /\b(middleware|service|controller|handler|component|endpoint|route|router|hook|adapter|provider|resolver|guard|interceptor|worker|migration|schema|client|store|queue|model|repository|module|api|config|parser|serializer|validator|listener|job|task|pipeline|form|page|screen|view|modal|widget)s?\b/i;

/** Words that mean "a unit of source code". */
const CODE_NOUN =
  /\b(file|function|method|class|variable|constant|type|interface|enum|package|folder|directory|script|test|helper|util|utility|constructor|field|property)s?\b/i;

/** The user is talking about the whole codebase, not the open file. */
const REPO_SCOPE =
  /\b(repo|repository|codebase|code\s?base|project|application|app|system|service|anywhere|across|everywhere|somewhere)\b/i;

const CHANGE_VERB =
  /\b(add|fix|refactor|rename|remove|delete|update|implement|migrate|wire|change|modify|create|write|convert|extract|move|replace|introduce|support|handle|patch)\b/i;

/**
 * Unambiguous "take me to the code" phrasing. Deliberately excludes a bare
 * `calls?` — that matched "who is on call this week".
 */
const LOCATE =
  /\b(where|which\s+file|what\s+file|find|defined|declared|located|lives?|live\s+in|show\s+me|point\s+me|list\s+all|callers?|called\s+by|(?:who|what|which)\s+calls?|(?:who|what|which)\s+(?:in\s+(?:this\s+)?repo\s+)?(?:still\s+)?owns?|references?|usages?|used\s+by|implemented|exists?|picking\s+up)\b/i;

/** "Does the project …?" — an existence question, answerable only from code. */
const EXISTENCE_START = /^(?:does|do|is|are|has|have)\b/i;

const UNDERSTAND =
  /\b(how\s+(?:does|do|is|are|would)|why\s+(?:do|does|did|is|are|was|were)|what\s+happens|what\s+does|flow|lifecycle|walk\s+(?:me\s+)?through|responsible\s+for|difference\s+between)\b/i;

/** "Explain the auth middleware" — an explanation request with no how/why. */
const EXPLAIN_VERB =
  /\b(explain|describe|summari[sz]e|tell\s+me\s+about|what\s+(?:is|are)\s+the|overview\s+of)\b/i;

/** About the conversation, not the code: "explain what you just did". */
const META_REFERENCE =
  /\b(you\s+just|your\s+(?:last|previous)\s+(?:answer|message|response|change|edit)|what\s+you\s+did|that\s+again)\b/i;

/**
 * How/why that is not a request to hunt the code.
 * "How does session refresh work?" still hunts; "How do I run the tests?" does not.
 */
const NON_CODE_HOW_WHY =
  /^(?:how\s+(?:much|old|long|big|large|often|soon|far|come)\b|how\s+(?:do|can|could|should|would)\s+i\b|how\s+can\s+you\b|why\s+am\s+i\b|why\s+(?:is|are)\s+(?:this|it|chat)\s+so\b|why\s+(?:is|does)\s+(?:this|it|chat)\s+tak(?:e|ing)\b|how\s+is\s+(?:the\s+)?(?:project|it|everything)\s+going\b)/i;

/** True when How/Why is a how-to, status, or product question — not a code hunt. */
export function isNonCodeHowWhyAsk(message: string): boolean {
  return NON_CODE_HOW_WHY.test(message.trim());
}

/**
 * "Don't search the repo", "without checking the codebase".
 * The negation must sit directly on the search verb — "don't just search the
 * repo, read the file too" is still a hunt.
 */
const NO_REPO_SEARCH =
  /\b(?:don'?t|do\s+not|no\s+need\s+to|without|avoid|skip)\s+(?:(?:bother\s+)?to\s+)?(?:search(?:ing)?|look(?:ing)?\s+(?:up|in|at|through)|check(?:ing)?|scan(?:ning)?|hunt(?:ing)?|grep(?:ping)?|index(?:ing)?)\s+(?:\w+\s+){0,2}?(?:repo|repository|codebase|code\s?base|index|project)\b/i;

/** "Don't invent a Coop file" — an honesty instruction, not a hunt request. */
const NO_INVENTED_FILE =
  /\b(?:don'?t|do\s+not|never)\s+(?:\w+\s+){0,2}?(?:invent|make\s+up|fabricate|guess)\b/i;

/** Programming and query languages. Frameworks are excluded on purpose — "how do we do React here" is a repo ask. */
const LANGUAGE_NAME =
  /\b(?:type\s?script|java\s?script|python|java|kotlin|swift|golang|rust|ruby|php|c\+\+|c#|objective-c|scala|elixir|erlang|clojure|haskell|perl|lua|dart|sql|bash|zsh|shell|powershell|html|css|sass|scss|regexp?|node\.?js|deno|bun)\b/i;

/** Bare `go` is a language only when the ask is scoped to it ("in Go, …"). */
const SCOPED_GO_LANGUAGE = /\b(?:in|with|using|for)\s+go\b/i;

/** Asking how something is written, not where it lives here. */
const SYNTAX_QUESTION =
  /\b(?:how\s+(?:do|can|could|would|should)\s+(?:i|you|we)\b|how\s+to\b|what'?s\s+the\s+(?:best\s+|correct\s+|right\s+|idiomatic\s+|proper\s+)?way\b|what\s+is\s+the\s+(?:best\s+|correct\s+|right\s+|idiomatic\s+|proper\s+)?way\b|is\s+there\s+a\s+way\b|what'?s\s+the\s+syntax\b|syntax\s+for\b|idiomatic\s+way\b)/i;

/** True when the user explicitly told Coop not to search the repository. */
export function isExplicitNoRepoSearchAsk(message: string): boolean {
  return NO_REPO_SEARCH.test(message.trim());
}

/**
 * Sentences that only tell Coop what not to do. They mention "repo" and "file"
 * without making the ask repo-scoped, so they are dropped before scope detection.
 */
function stripGroundingInstructions(message: string): string {
  return message
    // Only terminal punctuation — splitting on every dot would break `authMiddleware.ts`.
    .split(/[.?!]+(?=\s|$)/)
    .filter((sentence) => {
      const part = sentence.trim();
      return part.length > 0 && !NO_REPO_SEARCH.test(part) && !NO_INVENTED_FILE.test(part);
    })
    .join(" ")
    .trim();
}

/**
 * "In TypeScript, how do I make every property optional except one?"
 *
 * Language recall — the answer is the same in every repository, so hunting the
 * index can only produce a miss. Naming the repo, a path, or the open buffer
 * takes it back to a repo question.
 */
export function isGeneralLanguageQuestion(message: string): boolean {
  const scoped = stripGroundingInstructions(message);
  if (!scoped || !SYNTAX_QUESTION.test(scoped)) {
    return false;
  }
  if (!LANGUAGE_NAME.test(scoped) && !SCOPED_GO_LANGUAGE.test(scoped)) {
    return false;
  }
  return !REPO_SCOPE.test(scoped) && !LOCAL_SCOPE.test(scoped) && !NAMED_SOURCE_FILE.test(scoped);
}

/** Imperative change request: starts with the verb, or is politely prefixed. */
function looksLikeChangeRequest(message: string): boolean {
  const trimmed = message.trim();
  if (/^(?:can|could|would)\s+you\s+(?:please\s+)?\w+/i.test(trimmed) || /^please\s+\w+/i.test(trimmed)) {
    return CHANGE_VERB.test(trimmed);
  }
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  if (CHANGE_VERB.test(firstWord)) {
    return true;
  }
  // "I need to add a null check…", "we should refactor…"
  return /\b(?:need\s+to|should|want\s+to|let'?s)\s+(?:\w+\s+){0,2}?(?:add|fix|refactor|rename|remove|delete|update|implement|migrate|wire|change|create|write|replace)\b/i.test(
    trimmed
  );
}

export function classifyRepoCodeIntent(message: string): RepoCodeIntent {
  const trimmed = message?.trim() ?? "";
  if (trimmed.length < 8 || CONVERSATIONAL.test(trimmed) || META_REFERENCE.test(trimmed)) {
    return NONE;
  }
  // Inventory / layout facts use IndexedRepoWorkspace, not a hunt.
  if (isRepoStructureQuery(trimmed)) {
    return { action: "none", confidence: "high", reason: "indexed inventory or layout fact, not a code hunt" };
  }
  // "How do I…", "how old", "why is chat so slow" — not "how does this code work".
  if (isNonCodeHowWhyAsk(trimmed)) {
    return { action: "none", confidence: "high", reason: "how-to or product question, not a code hunt" };
  }
  // An explicit opt-out beats every hunt heuristic below it.
  if (isExplicitNoRepoSearchAsk(trimmed)) {
    return { action: "none", confidence: "high", reason: "user asked not to search the repository" };
  }
  // "In TypeScript, how do I…" — language recall. The index can only miss.
  if (isGeneralLanguageQuestion(trimmed)) {
    return { action: "none", confidence: "high", reason: "general language question, not a code hunt" };
  }

  const hasEntity = IDENTIFIER.test(trimmed) || FILE_PATH.test(trimmed) || BACKTICKED.test(trimmed);
  const hasRole = ROLE_NOUN.test(trimmed);
  const hasRepoScope = REPO_SCOPE.test(trimmed);
  const hasCodeNoun = CODE_NOUN.test(trimmed);

  // "explain this function" is about the open buffer unless it also names
  // something concrete elsewhere in the repository.
  if (LOCAL_SCOPE.test(trimmed) && !hasEntity && !hasRepoScope) {
    return NONE;
  }

  const hasSubject = hasEntity || hasRole || hasRepoScope || hasCodeNoun;
  const words = trimmed.split(/\s+/).length;

  // A bare fragment that names nothing ("find auth") is too vague to hunt on.
  if (!hasSubject && words < 4) {
    return NONE;
  }

  const subject = hasEntity
    ? "names code"
    : hasRole || hasCodeNoun
      ? "names a code role"
      : hasRepoScope
        ? "repo-scoped"
        : "describes system behaviour";
  const confidence = hasEntity ? "high" : hasSubject ? "medium" : "low";

  // Weak question forms need either a code subject or enough substance to be a
  // real question, so "are you sure?" never starts a hunt.
  const weakFormAllowed = hasSubject || words >= 5;

  if (looksLikeChangeRequest(trimmed)) {
    return { action: "change", confidence, reason: `change request that ${subject}` };
  }
  // Inventory "how many files in this repo" already returned none. Remaining
  // "how many files import X" is a search, not a total.
  if (/\bhow many files\b/i.test(trimmed)) {
    return { action: "locate", confidence, reason: `asks how many files match a condition and ${subject}` };
  }
  if (LOCATE.test(trimmed)) {
    return { action: "locate", confidence, reason: `asks where something is and ${subject}` };
  }
  // "Read src/server/authMiddleware.ts" — a named file is a hunt, not small talk.
  if (NAMED_SOURCE_FILE.test(trimmed)) {
    return { action: "locate", confidence: "high", reason: "names a source file" };
  }
  if (EXISTENCE_START.test(trimmed) && weakFormAllowed) {
    return { action: "locate", confidence, reason: `asks whether code exists and ${subject}` };
  }
  if (UNDERSTAND.test(trimmed) && weakFormAllowed) {
    return { action: "understand", confidence, reason: `asks how or why and ${subject}` };
  }
  if (EXPLAIN_VERB.test(trimmed) && weakFormAllowed) {
    return { action: "understand", confidence, reason: `asks for an explanation and ${subject}` };
  }
  return NONE;
}

/** Whether this turn should gather evidence from the repository at all. */
export function needsRepoCode(message: string): boolean {
  return classifyRepoCodeIntent(message).action !== "none";
}

/** Understand Repo / slash focus that is a "where does this live" locate, not an architecture overview. */
export function isLocateShapedRepoAsk(message: string | undefined): boolean {
  const trimmed = message?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return classifyRepoCodeIntent(trimmed).action === "locate";
}
