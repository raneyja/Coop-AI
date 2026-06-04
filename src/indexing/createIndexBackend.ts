import type * as vscode from "vscode";
import { readLightningBackend, readLightningConfiguration } from "../config/lightningConfig";
import type { CoopBackendClient } from "../api/CoopBackendClient";
import type { IndexManager } from "./indexManager";
import type { IndexBackend } from "./indexBackend";
import { LocalIndexBackend } from "./localIndexBackend";
import { CloudIndexBackend } from "./cloudIndexBackend";

export function createIndexBackend(options: {
  indexManager: IndexManager;
  client: CoopBackendClient;
  getBaseUrl: () => string;
  secrets?: vscode.SecretStorage;
}): IndexBackend {
  const backend = readLightningBackend();
  if (backend === "cloud") {
    return new CloudIndexBackend(options.client, options.getBaseUrl, options.secrets);
  }
  return new LocalIndexBackend(options.indexManager);
}

export { readLightningConfiguration };
