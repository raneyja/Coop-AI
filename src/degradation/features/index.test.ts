import assert from "node:assert/strict";
import { CODE_HOST_PROVIDERS, type CodeHostProvider } from "../../api/codeHosts/types";
import type { DegradationCache } from "../../cache/degradationCache";
import type { ContextFetchRequest } from "../../context/requestBatcher";
import type { IntegrationHealth, IntegrationProvider, IntegrationStatus } from "../../integrations/healthMonitor";
import { indexedUseRepoHosts, promoteIndexedOrConnectedCodeHosts, connectedCodeHostsFromPrefs } from "../fallbackMatrix";
import { runFeatureFallback } from "./index";
import { resolveFeatureForRequest } from "./resolveFeatureForRequest";

assert.equal(resolveFeatureForRequest("knowledge-gaps", "ownership"), "ownership_map");
assert.equal(resolveFeatureForRequest("knowledge-gaps", "dependencies"), "blast_radius");
assert.equal(resolveFeatureForRequest("knowledge-gaps", "knowledge_gaps"), "knowledge_gaps");
assert.equal(resolveFeatureForRequest("blast-radius", "dependencies"), "blast_radius");

const cache: DegradationCache = {
  async get() {
    return undefined;
  },
  async getRaw() {
    return undefined;
  },
  async set() {},
  async delete() {},
  async clear() {}
};

function health(provider: IntegrationProvider, status: IntegrationStatus): IntegrationHealth {
  return {
    provider,
    status,
    lastCheck: new Date("2026-09-25T00:00:00Z"),
    recoveryStrategy: status === "healthy" ? "retry" : "cache"
  };
}

function request(
  host: CodeHostProvider,
  type: "ownership" | "dependencies" | "knowledge_gaps" | "decision_history" | "file_metadata",
  quickAction?: string
): ContextFetchRequest {
  return {
    id: `${type}-${host}`,
    type,
    params: {
      quickAction,
      provider: host,
      repoId: `${host}:acme/app`,
      owner: "acme",
      repo: "app",
      file: "src/app.ts"
    },
    intent: {
      id: "intent-1",
      intent: "quick_action_clicked",
      timestamp: new Date("2026-09-25T00:00:00Z"),
      context: { provider: host, owner: "acme", repo: "app", file: "src/app.ts" },
      costEstimate: "cheap"
    },
    cost: "cheap",
    createdAt: new Date("2026-09-25T00:00:00Z")
  } as ContextFetchRequest;
}

const FANOUT: Array<{
  type: "ownership" | "dependencies" | "knowledge_gaps" | "decision_history" | "file_metadata";
  quickAction?: string;
}> = [
  { type: "ownership", quickAction: "knowledge-gaps" },
  { type: "dependencies", quickAction: "knowledge-gaps" },
  { type: "knowledge_gaps", quickAction: "knowledge-gaps" },
  { type: "ownership", quickAction: "find-owner" },
  { type: "dependencies", quickAction: "blast-radius" },
  { type: "decision_history", quickAction: "trace-decision" },
  { type: "file_metadata", quickAction: "understand-repo" },
  { type: "ownership" }
];

async function assertIndexedFanoutHasNoOfflineBanner(): Promise<void> {
  for (const host of CODE_HOST_PROVIDERS) {
    const offline = [
      ...CODE_HOST_PROVIDERS.map((entry) => health(entry, "offline")),
      health("slack", "offline")
    ];
    const promoted = promoteIndexedOrConnectedCodeHosts(offline, new Set(), indexedUseRepoHosts(host, true));
    for (const fan of FANOUT) {
      const result = await runFeatureFallback({
        request: request(host, fan.type, fan.quickAction),
        health: promoted,
        cache
      });
      const copy = `${result?.error ?? ""} ${result?.message ?? ""}`;
      assert.doesNotMatch(
        copy,
        /is offline/,
        `${fan.type} on indexed ${host} must not say the host is offline`
      );
      // Understand Repo without a registered summary loader still asks to connect —
      // that is not the false offline hard-gate.
      if (fan.quickAction !== "understand-repo") {
        assert.equal(
          result?.error,
          undefined,
          `${fan.type}/${fan.quickAction ?? "plain"} on indexed ${host} must not hard-fail`
        );
      }
    }

    // Settings Ready via org statuses only (AppInstalled false)
    const connectedOnly = promoteIndexedOrConnectedCodeHosts(
      offline,
      connectedCodeHostsFromPrefs({
        orgIntegrationStatuses: [{ provider: host, installed: true }],
        hasGitHubAppInstalled: false,
        hasGitLabAppInstalled: false,
        hasBitbucketAppInstalled: false
      }),
      new Set()
    );
    for (const action of [
      "blast-radius",
      "find-owner",
      "knowledge-gaps",
      "trace-decision",
      "understand-repo"
    ] as const) {
      const type =
        action === "blast-radius"
          ? "dependencies"
          : action === "trace-decision"
            ? "decision_history"
            : action === "knowledge-gaps"
              ? "knowledge_gaps"
              : action === "understand-repo"
                ? "file_metadata"
                : "ownership";
      const result = await runFeatureFallback({
        request: request(host, type, action),
        health: connectedOnly,
        cache
      });
      assert.doesNotMatch(
        `${result?.error ?? ""} ${result?.message ?? ""}`,
        /is offline/,
        `${action} on orgStatuses-Ready ${host} must not emit offline banner`
      );
      if (action !== "understand-repo") {
        assert.equal(
          result?.error,
          undefined,
          `${action} on orgStatuses-Ready ${host} must not hard-fail`
        );
      }
    }

    const blocked = await runFeatureFallback({
      request: request(host, "ownership", "find-owner"),
      health: offline,
      cache
    });
    assert.match(
      blocked?.error ?? "",
      /is offline/,
      `${host} owner still banners when the repo is not indexed and the host is disconnected`
    );
  }
}

void assertIndexedFanoutHasNoOfflineBanner()
  .then(() => {
    console.log("degradation/features/index: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
