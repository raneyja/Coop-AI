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
  /^(?:thanks|thank\s+you|ty|ok|okay|k|got\s+it|nice|cool|great|perfect|yes|yep|no|nope|sure|sounds\s+good|never\s+mind)\b/i;

/**
 * True when the whole message is small talk ("Thanks"), not "ok now add logging".
 * Prefix-only matching would steal real change asks that start with "ok".
 */
export function isConversationalChat(message: string): boolean {
  return /^(?:thanks|thank\s+you|ty|ok(?:ay)?|k|got\s+it|nice|cool|great|perfect|yes|yep|no|nope|sure|sounds\s+good|never\s+mind)(?:\s+thanks?)?(?:\s+that(?:'s|\s+is)?\s+worked)?[.!?]*$/i.test(
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
  /\b(where|which\s+file|what\s+file|find|defined|declared|located|lives?|live\s+in|show\s+me|point\s+me|list\s+all|callers?|called\s+by|(?:who|what|which)\s+calls?|references?|usages?|used\s+by|implemented|exists?)\b/i;

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

/** "why …" / "how …" is an explanation request even when it also says "do we have". */
const EXPLANATION_START = /^(?:why|how)\b/i;

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
  if (EXPLANATION_START.test(trimmed) && weakFormAllowed) {
    return { action: "understand", confidence, reason: `asks why or how and ${subject}` };
  }
  if (LOCATE.test(trimmed)) {
    return { action: "locate", confidence, reason: `asks where something is and ${subject}` };
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
