import type { CodeHostProviderPreference } from "../chat/types";

export type IndexedRepoFileReadRequest = {
  repoId: string;
  owner?: string;
  repo?: string;
  branch?: string;
  provider?: CodeHostProviderPreference;
  path: string;
  lines?: { start: number; end: number };
};

export type IndexedRepoFileReader = (
  request: IndexedRepoFileReadRequest
) => Promise<string | undefined>;

let reader: IndexedRepoFileReader | undefined;

export function registerIndexedRepoFileReader(next: IndexedRepoFileReader): void {
  reader = next;
}

export function getIndexedRepoFileReader(): IndexedRepoFileReader | undefined {
  return reader;
}
