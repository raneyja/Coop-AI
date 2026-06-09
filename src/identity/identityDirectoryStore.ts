import type * as vscode from "vscode";
import { CoopBackendClient } from "../api/CoopBackendClient";
import { normalizeIdentityDirectory } from "./identityDirectory";
import type { IdentityDirectory } from "./types";
import { EMPTY_IDENTITY_DIRECTORY } from "./types";

const GLOBAL_STATE_KEY = "coopAI.identityDirectory";

export class IdentityDirectoryStore {
  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly backend: CoopBackendClient
  ) {}

  public async load(apiBaseUrl?: string): Promise<IdentityDirectory> {
    const local = normalizeIdentityDirectory(this.context.globalState.get(GLOBAL_STATE_KEY));
    if (!apiBaseUrl) {
      return local;
    }
    try {
      const remote = normalizeIdentityDirectory(await this.backend.fetchIdentityDirectory(apiBaseUrl));
      if (remote.people.length > 0) {
        await this.context.globalState.update(GLOBAL_STATE_KEY, remote);
        return remote;
      }
    } catch {
      // Fall back to local directory when backend is unavailable.
    }
    return local;
  }

  public async save(directory: IdentityDirectory, apiBaseUrl?: string): Promise<IdentityDirectory> {
    const normalized = normalizeIdentityDirectory(directory);
    await this.context.globalState.update(GLOBAL_STATE_KEY, normalized);
    if (apiBaseUrl) {
      try {
        await this.backend.saveIdentityDirectory(apiBaseUrl, normalized);
      } catch {
        // Local save still succeeds for offline/dev use.
      }
    }
    return normalized;
  }

  public readLocal(): IdentityDirectory {
    return normalizeIdentityDirectory(this.context.globalState.get(GLOBAL_STATE_KEY));
  }

  public async clear(apiBaseUrl?: string): Promise<void> {
    await this.context.globalState.update(GLOBAL_STATE_KEY, { ...EMPTY_IDENTITY_DIRECTORY });
    if (apiBaseUrl) {
      try {
        await this.backend.saveIdentityDirectory(apiBaseUrl, { ...EMPTY_IDENTITY_DIRECTORY });
      } catch {
        // ignore
      }
    }
  }
}
