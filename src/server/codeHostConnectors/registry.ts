import type { CodeHostProvider } from "../../api/codeHosts/types";
import type { CodeHostConnector } from "./types";

const connectors = new Map<CodeHostProvider, CodeHostConnector>();

/**
 * Register a connector.  Call once per provider during server startup before
 * any requests are served.  Re-registering the same provider replaces the
 * previous connector (safe for testing).
 */
export function registerConnector(connector: CodeHostConnector): void {
  connectors.set(connector.provider, connector);
}

/**
 * Retrieve the connector for a provider, or undefined if that host is not
 * configured on this deployment.
 */
export function getConnector(provider: CodeHostProvider): CodeHostConnector | undefined {
  return connectors.get(provider);
}

/** Returns providers that have a connector registered. */
export function getRegisteredProviders(): CodeHostProvider[] {
  return [...connectors.keys()];
}

/** Remove all connectors — used in tests to reset state between cases. */
export function clearConnectors(): void {
  connectors.clear();
}
