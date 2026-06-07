import type { FeatureExecutionContext } from "../degradation/features/types";

export type RepoSummaryLoader = (
  context: FeatureExecutionContext
) => Promise<Record<string, unknown> | undefined>;

let registeredLoader: RepoSummaryLoader | undefined;

export function registerRepoSummaryLoader(loader: RepoSummaryLoader): void {
  registeredLoader = loader;
}

export function getRepoSummaryLoader(): RepoSummaryLoader | undefined {
  return registeredLoader;
}
