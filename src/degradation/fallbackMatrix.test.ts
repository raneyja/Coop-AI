import assert from "node:assert/strict";
import { CODE_HOST_PROVIDERS, type CodeHostProvider } from "../api/codeHosts/types";
import type { IntegrationHealth, IntegrationProvider, IntegrationStatus } from "../integrations/healthMonitor";
import {
  fallbackStatusForFeature,
  indexedUseRepoHosts,
  promoteIndexedOrConnectedCodeHosts,
  promoteOrgConnectedCodeHosts,
  providersForFeature,
  type QuickActionFeatureId
} from "./fallbackMatrix";

const ACTIONS: QuickActionFeatureId[] = [
  "find-owner",
  "trace-decision",
  "blast-radius",
  "knowledge-gaps",
  "understand-repo"
];

function health(provider: IntegrationProvider, status: IntegrationStatus): IntegrationHealth {
  return {
    provider,
    status,
    lastCheck: new Date("2026-09-25T00:00:00Z"),
    recoveryStrategy: status === "healthy" ? "retry" : "cache"
  };
}

function otherHostsOffline(active: CodeHostProvider): IntegrationHealth[] {
  return CODE_HOST_PROVIDERS.filter((host) => host !== active).map((host) => health(host, "offline"));
}

const OPTIONAL_HEALTHY: IntegrationHealth[] = [
  health("slack", "healthy"),
  health("jira", "healthy"),
  health("teams", "healthy"),
  health("confluence", "healthy"),
  health("notion", "healthy"),
  health("google-docs", "healthy")
];

for (const host of CODE_HOST_PROVIDERS) {
  for (const action of ACTIONS) {
    const status = fallbackStatusForFeature(
      action,
      [health(host, "healthy"), ...OPTIONAL_HEALTHY, ...otherHostsOffline(host)],
      host
    );
    assert.equal(status.level, "full", `${action} on ${host} should be full when that host is healthy`);
    assert.deepEqual(status.required, [host]);
    assert.equal(
      status.unavailableProviders.includes("github") && host !== "github",
      false,
      `${action} must not treat GitHub as down when the repo is on ${host}`
    );
    assert.deepEqual(providersForFeature(action, host).required, [host]);
  }
}

const gitlabOwner = fallbackStatusForFeature(
  "find-owner",
  [health("github", "offline"), health("gitlab", "healthy"), health("slack", "offline")],
  "gitlab"
);
assert.equal(gitlabOwner.level, "partial");
assert.deepEqual(gitlabOwner.required, ["gitlab"]);
assert.deepEqual(gitlabOwner.unavailableProviders, ["slack"]);
assert.equal(gitlabOwner.message, "Show ownership without availability (unknown if online)");
assert.doesNotMatch(gitlabOwner.message, /GitLab is offline|GitHub/i);

const gitlabDown = fallbackStatusForFeature(
  "find-owner",
  [health("github", "healthy"), health("gitlab", "offline"), health("slack", "healthy")],
  "gitlab"
);
assert.equal(gitlabDown.level, "unavailable");
assert.deepEqual(gitlabDown.unavailableProviders, ["gitlab"]);

const unknownHost = fallbackStatusForFeature(
  "find-owner",
  [health("github", "offline"), health("slack", "healthy")]
);
assert.notEqual(unknownHost.level, "unavailable");
assert.deepEqual(unknownHost.required, []);

const slowBlast = fallbackStatusForFeature("blast-radius", [health("bitbucket", "degraded")], "bitbucket");
assert.equal(slowBlast.level, "partial");
assert.match(slowBlast.message, /simplified analysis/i);

const promoted = promoteOrgConnectedCodeHosts(
  [health("github", "offline"), health("gitlab", "offline"), health("bitbucket", "offline"), health("slack", "offline")],
  new Set<CodeHostProvider>(["gitlab"])
);
assert.equal(promoted.find((entry) => entry.provider === "gitlab")?.status, "healthy");
assert.equal(promoted.find((entry) => entry.provider === "github")?.status, "offline");
assert.equal(promoted.find((entry) => entry.provider === "bitbucket")?.status, "offline");
assert.equal(promoted.find((entry) => entry.provider === "slack")?.status, "offline");

const GATED_ACTIONS: QuickActionFeatureId[] = [
  "find-owner",
  "knowledge-gaps",
  "blast-radius",
  "trace-decision"
];

function probeOffline(active: CodeHostProvider): IntegrationHealth[] {
  return [health(active, "offline"), ...otherHostsOffline(active), health("slack", "offline")];
}

for (const host of CODE_HOST_PROVIDERS) {
  const indexedOnly = indexedUseRepoHosts(host, true);
  const notIndexed = indexedUseRepoHosts(host, false);
  assert.equal(notIndexed.size, 0, `${host} must not promote when the Use-repo is not indexed`);
  assert.deepEqual([...indexedOnly], [host]);

  for (const action of GATED_ACTIONS) {
    const offline = probeOffline(host);
    const byIndex = promoteIndexedOrConnectedCodeHosts(offline, new Set(), indexedOnly);
    const indexedStatus = fallbackStatusForFeature(action, byIndex, host);
    assert.notEqual(
      indexedStatus.level,
      "unavailable",
      `${action} on indexed ${host} must not be unavailable when the probe is offline`
    );

    const byOrg = promoteIndexedOrConnectedCodeHosts(offline, new Set([host]), notIndexed);
    const connectedStatus = fallbackStatusForFeature(action, byOrg, host);
    assert.notEqual(
      connectedStatus.level,
      "unavailable",
      `${action} on org-connected ${host} must not be unavailable when the probe is offline`
    );

    const neither = promoteIndexedOrConnectedCodeHosts(offline, new Set(), notIndexed);
    const blocked = fallbackStatusForFeature(action, neither, host);
    assert.equal(
      blocked.level,
      "unavailable",
      `${action} on ${host} stays unavailable when not indexed and not connected`
    );
  }

  const cross = promoteIndexedOrConnectedCodeHosts(
    CODE_HOST_PROVIDERS.map((entry) => health(entry, "offline")),
    new Set(),
    indexedOnly
  );
  for (const other of CODE_HOST_PROVIDERS) {
    assert.equal(
      cross.find((entry) => entry.provider === other)?.status,
      other === host ? "healthy" : "offline",
      `indexing ${host} must not change ${other}`
    );
  }
}

assert.equal(indexedUseRepoHosts(undefined, true).size, 0);

console.log("degradation/fallbackMatrix: ok");
