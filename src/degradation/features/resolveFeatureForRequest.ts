import type { ContextRequestType } from "../../context/intentDetector";
import {
  normalizeFeatureId,
  type FeatureId,
  type QuickActionFeatureId
} from "../fallbackMatrix";

export function resolveFeatureForRequest(action: QuickActionFeatureId, requestType: ContextRequestType): FeatureId {
  switch (action) {
    case "understand-repo":
      if (requestType === "ownership") {
        return "ownership_map";
      }
      if (requestType === "dependencies") {
        return "blast_radius";
      }
      return "repo_summary";
    case "find-owner":
      return "ownership_map";
    case "trace-decision":
      return "trace_why";
    case "blast-radius":
      return "blast_radius";
    case "knowledge-gaps":
      if (requestType === "ownership") {
        return "ownership_map";
      }
      if (requestType === "dependencies") {
        return "blast_radius";
      }
      return "knowledge_gaps";
    default:
      return normalizeFeatureId(action);
  }
}
