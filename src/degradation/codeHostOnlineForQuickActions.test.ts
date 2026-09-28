import assert from "node:assert/strict";
import { CODE_HOST_PROVIDERS, type CodeHostProvider } from "../api/codeHosts/types";
import {
  connectedCodeHostsFromPrefs,
  isCodeHostOnlineForQuickActions,
  isDeepIndexedForQuickActions,
  isHostConnectedForQuickActions,
  repoIdCandidatesForIndexStatus
} from "./codeHostOnlineForQuickActions";
import {
  fallbackStatusForFeature,
  indexedUseRepoHosts,
  promoteIndexedOrConnectedCodeHosts,
  type QuickActionFeatureId
} from "./fallbackMatrix";
import type { IntegrationHealth, IntegrationProvider, IntegrationStatus } from "../integrations/healthMonitor";

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
    lastCheck: new Date("2026-09-28T00:00:00Z"),
    recoveryStrategy: status === "healthy" ? "retry" : "cache"
  };
}

function probeOffline(active: CodeHostProvider): IntegrationHealth[] {
  return [
    health(active, "offline"),
    ...CODE_HOST_PROVIDERS.filter((host) => host !== active).map((host) => health(host, "offline")),
    health("slack", "offline")
  ];
}

// --- Hole 1: orgIntegrationStatuses Ready with has*AppInstalled === false ---
for (const host of CODE_HOST_PROVIDERS) {
  const prefs = {
    orgIntegrationStatuses: [
      { provider: host, installed: true, needsReconnect: false, scopeNeedsReconnect: false }
    ],
    hasGitHubAppInstalled: false,
    hasGitLabAppInstalled: false,
    hasBitbucketAppInstalled: false
  };
  assert.equal(
    isHostConnectedForQuickActions(prefs, host),
    true,
    `${host} must promote from orgIntegrationStatuses Ready without AppInstalled`
  );
  const connected = connectedCodeHostsFromPrefs(prefs);
  assert.ok(connected.has(host), `${host} in connected set from org statuses`);
  for (const other of CODE_HOST_PROVIDERS) {
    if (other !== host) {
      assert.equal(connected.has(other), false, `org Ready ${host} must not mark ${other} connected`);
    }
  }

  const offline = probeOffline(host);
  const promoted = promoteIndexedOrConnectedCodeHosts(offline, connected, new Set());
  for (const action of ACTIONS) {
    const status = fallbackStatusForFeature(action, promoted, host);
    assert.notEqual(
      status.level,
      "unavailable",
      `${action} on Settings-Ready ${host} (AppInstalled false) must not be unavailable`
    );
  }
}

// needsReconnect on org entry alone does not Ready-promote; AppInstalled still can
assert.equal(
  isHostConnectedForQuickActions(
    {
      orgIntegrationStatuses: [{ provider: "gitlab", installed: true, needsReconnect: true }],
      hasGitLabAppInstalled: false
    },
    "gitlab"
  ),
  false
);
assert.equal(
  isHostConnectedForQuickActions(
    {
      orgIntegrationStatuses: [{ provider: "gitlab", installed: true, needsReconnect: true }],
      hasGitLabAppInstalled: true
    },
    "gitlab"
  ),
  true
);

// --- Hole 2: indexStatus ready without enabled ---
assert.equal(isDeepIndexedForQuickActions({ status: "ready", enabled: false }), true);
assert.equal(isDeepIndexedForQuickActions({ status: "ready", enabled: true }), true);
assert.equal(isDeepIndexedForQuickActions({ status: "idle", enabled: true }), false);
assert.equal(isDeepIndexedForQuickActions(undefined), false);

for (const host of CODE_HOST_PROVIDERS) {
  const indexed = indexedUseRepoHosts(host, isDeepIndexedForQuickActions({ status: "ready", enabled: false }));
  const promoted = promoteIndexedOrConnectedCodeHosts(probeOffline(host), new Set(), indexed);
  for (const action of ACTIONS) {
    assert.notEqual(
      fallbackStatusForFeature(action, promoted, host).level,
      "unavailable",
      `${action} on ready-but-not-enabled ${host} must not be unavailable`
    );
  }
}

// --- Hole 3 helpers: repo id candidates + case ---
const candidates = repoIdCandidatesForIndexStatus({
  codeHost: "gitlab",
  requestRepoId: "gitlab:Coop-AI/plane",
  owner: "Coop-AI",
  repo: "plane",
  workspaceRepoIds: ["gitlab:coop-ai/plane", "github:other/repo"]
});
assert.ok(candidates.includes("gitlab:Coop-AI/plane"));
assert.ok(candidates.includes("gitlab:coop-ai/plane"));
assert.equal(
  candidates.some((id) => id.startsWith("github:")),
  false,
  "workspace ids on other hosts must not enter candidates"
);

// Request repoId for a different host is ignored
assert.deepEqual(
  repoIdCandidatesForIndexStatus({
    codeHost: "gitlab",
    requestRepoId: "github:acme/app",
    owner: "acme",
    repo: "app"
  }),
  ["gitlab:acme/app"]
);

// --- Online SoT ---
assert.equal(
  isCodeHostOnlineForQuickActions("gitlab", {
    probeStatus: "offline",
    connectedHosts: new Set(["gitlab"]),
    indexedHosts: new Set()
  }),
  true
);
assert.equal(
  isCodeHostOnlineForQuickActions("gitlab", {
    probeStatus: "offline",
    connectedHosts: new Set(),
    indexedHosts: new Set(["gitlab"])
  }),
  true
);
assert.equal(
  isCodeHostOnlineForQuickActions("gitlab", {
    probeStatus: "offline",
    connectedHosts: new Set(),
    indexedHosts: new Set()
  }),
  false
);
assert.equal(
  isCodeHostOnlineForQuickActions("gitlab", {
    probeStatus: "degraded",
    connectedHosts: new Set(),
    indexedHosts: new Set()
  }),
  true
);

// Neither → unavailable for all actions × hosts
for (const host of CODE_HOST_PROVIDERS) {
  for (const action of ACTIONS) {
    const blocked = fallbackStatusForFeature(
      action,
      promoteIndexedOrConnectedCodeHosts(probeOffline(host), new Set(), indexedUseRepoHosts(host, false)),
      host
    );
    assert.equal(blocked.level, "unavailable", `${action} on ${host} stays unavailable when neither`);
  }
}

console.log("degradation/codeHostOnlineForQuickActions: ok");
