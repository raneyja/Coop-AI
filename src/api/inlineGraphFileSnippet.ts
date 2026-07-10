import { GitHubClient } from "./codeHosts/githubClient";
import { GitLabClient } from "./codeHosts/gitlabClient";
import { BitbucketClient } from "./codeHosts/bitbucketClient";
import { CodeHostError } from "./codeHosts/types";
import type { RemoteFileContent, RepoCoordinates } from "./codeHosts/types";
import { parseRepoId } from "../jobs/buildStructureManifest";
import { resolveCodeHostTokenForOrg } from "../server/codeHostCredentialResolver";
import { getConnector } from "../server/codeHostConnectors/registry";
import type { OrgStore } from "../server/orgStore";
import type { ServerConfig } from "../server/serverConfig";
import type { InlineGraphFileSnippetFetcher } from "./inlineGraphContext";

const SNIPPET_FETCH_TIMEOUT_MS = 80;
const MAX_SNIPPET_BYTES = 4_096;

export function createOrgInlineGraphFileSnippetFetcher(deps: {
  orgStore: OrgStore;
  serverConfig: ServerConfig;
}): InlineGraphFileSnippetFetcher {
  return async ({ orgId, repoId, path }) => {
    if (!orgId?.trim()) {
      return undefined;
    }
    try {
      const target = parseRepoId(repoId);
      const token = await resolveCodeHostTokenForOrg(orgId, target.provider, {
        orgStore: deps.orgStore,
        connector: getConnector(target.provider),
        allowPatFallback: deps.serverConfig.devMode
      });
      if (!token) {
        return undefined;
      }
      const file = await withTimeout(
        fetchRepoFileContent(target, path, token),
        SNIPPET_FETCH_TIMEOUT_MS
      );
      if (!file?.content) {
        return undefined;
      }
      return file.content.length > MAX_SNIPPET_BYTES
        ? file.content.slice(0, MAX_SNIPPET_BYTES)
        : file.content;
    } catch {
      return undefined;
    }
  };
}

async function fetchRepoFileContent(
  coords: RepoCoordinates,
  filePath: string,
  token: string
): Promise<RemoteFileContent | undefined> {
  switch (coords.provider) {
    case "github":
      return new GitHubClient({ token }).getFileContent(coords, filePath);
    case "gitlab":
      return new GitLabClient({ token }).getFileContent(coords, filePath);
    case "bitbucket":
      return new BitbucketClient({ token }).getFileContent(coords, filePath);
    default:
      throw new CodeHostError(`Unsupported provider: ${coords.provider}`, "unsupported");
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}
