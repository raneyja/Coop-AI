import { isRequestedFileQuestion } from "./requestedRepoFiles";
import { isApiRejectAsk, isBackendStateLocateAsk, isParserLocateAsk } from "./searchQuery";
import { isFileCallerQuery, isShipCheckQuery } from "../../context/fileCallerIntent";
import { isFileHistoryQuery } from "../../context/fileHistoryIntent";
import { isFeatureAddAsk } from "../../context/existingCapabilityGrounding";

/** Requested bodies can answer this ask without a discovery or editing loop. */
export function isDirectRepoFileQuestion(query: string): boolean {
  return isRequestedFileQuestion(query) && !isApiRejectAsk(query) &&
    !isBackendStateLocateAsk(query) && !isParserLocateAsk(query) &&
    !isFileCallerQuery(query) && !isFileHistoryQuery(query) &&
    !isShipCheckQuery(query) && !isFeatureAddAsk(query) &&
    !/\b(?:find|locate|search|trace|callers?|dependents?|references?|usages?|history|blame|commits?|where|edit|modify|implement|fix|refactor|rename|delete|add|insert|append|change|update|replace|remove|write|create|generate|review|audit|risk|security|vulnerabilit(?:y|ies)|impact|affected|owners?|ownership|dependenc(?:y|ies)|across|every|repo(?:sitory)?[- ]wide)\b/i.test(query);
}
