/**
 * Incident / on-call shaped chat intent.
 *
 * A9 owns failure/outage reconstruction. A8 owns status-machine questions
 * (PENDING → COMPLETED, where status is written). Keep heuristics distinct so
 * the two paths do not double-route.
 */

function normalize(queryText: string | undefined): string {
  return queryText?.trim().toLowerCase() ?? "";
}

/** Strong operational / support signals — enough alone to treat as incident. */
const STRONG_INCIDENT_RE =
  /\b(incident|outage|on-?call|oncall|sev[0-3]|pager|pages?\b|postmortem|post-mortem|war\s*room)\b/;

/** Failure / retry / webhook storm signals (often paired with time or ops context). */
const FAILURE_SIGNAL_RE =
  /\b(failing|failures?|failed|retries?|retry\s+storm|webhook\s+fail|board\s+sync|sync\s+fail|errors?\s+last|last\s+week|past\s+week|this\s+week|stuck\s+(?:after|on|in|during)|keeps?\s+retrying|retrying|timed?\s*out|timeouts?)\b/;

/**
 * Status-machine / transition questions — A8 territory.
 * "Stuck PENDING / where does status move to COMPLETED" must not become an
 * incident reconstruction just because it contains "stuck".
 */
export function isStatusTransitionIntent(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q) {
    return false;
  }

  if (
    /\b(pending|completed|draft|voided)\b/.test(q) &&
    /\b(status|state|seal|transition|become|becomes|moves?|moved|writes?|written|update|updates)\b/.test(q)
  ) {
    return true;
  }

  if (/\bwhere\s+does\s+(the\s+)?status\b/.test(q) || /\bstatus\s+(move|transition|become|change|update)\b/.test(q)) {
    return true;
  }

  if (/\b(seal-?document|documentstatus|signingstatus)\b/.test(q)) {
    return true;
  }

  if (/\b(pending\s*→\s*completed|pending\s+to\s+completed|pending\s*->\s*completed)\b/.test(q)) {
    return true;
  }

  return false;
}

function hasStrongIncidentSignal(q: string): boolean {
  return STRONG_INCIDENT_RE.test(q);
}

function hasFailureSignal(q: string): boolean {
  return FAILURE_SIGNAL_RE.test(q);
}

/**
 * True when free-form chat should reconstruct an incident (code path + Slack/Jira).
 * Prefers clear outage/failure heuristics over status-machine questions.
 */
export function isIncidentShapedQuery(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q) {
    return false;
  }

  const strong = hasStrongIncidentSignal(q);
  const failure = hasFailureSignal(q);

  // Status-machine asks stay with A8 unless the user also framed a real incident.
  if (isStatusTransitionIntent(q) && !strong) {
    return false;
  }

  if (strong) {
    return true;
  }

  if (failure) {
    return true;
  }

  // "stuck" alone is ambiguous — need ops/failure co-signal.
  if (/\bstuck\b/.test(q) && /\b(webhook|sync|retry|fail|error|outage|incident|board|job|queue|worker)\b/.test(q)) {
    return true;
  }

  return false;
}

/** Whether chat_context should auto-fetch Slack/Jira for this turn. */
export function shouldFetchIncidentIntegrations(queryText: string | undefined): boolean {
  return isIncidentShapedQuery(queryText);
}
