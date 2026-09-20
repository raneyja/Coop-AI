/**
 * End-to-end planner decision for the product example:
 * "help me understand which files will be impacted… check jira…"
 * Gate: tools-only + jira fetch, not silent blast-radius.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { planChatIntentFromRules } from "./planChatIntent";
import { resolveChatIntentExecution } from "./resolveExecution";
import {
  buildIntentPlanActivityMessages,
  buildIntentPlanStatusLine
} from "./intentPlanTrust";
import { assertAllGatesPass, gateFail, gatePass, type GateResult } from "./gates";

test("Example ask: blast impact + Jira → tools-only with jira (not silent Blast)", () => {
  const results: GateResult[] = [];

  const plan = planChatIntentFromRules({
    message:
      "help me understand which files will be impacted if I make changes to this open file. Be sure to check jira for open tickets as well",
    activeFile: "src/chat/CoopChatSession.ts",
    connectedTools: ["jira", "slack"]
  });

  try {
    assert.equal(plan.workflow, undefined);
    assert.ok(plan.tools.includes("jira"));
    assert.equal(plan.execution, "none");
    assert.notEqual(plan.mode, "run-workflow");
    results.push(
      gatePass(2, "EX-G1", "Compound impact+jira stays tools-only with jira tool")
    );
  } catch (error) {
    results.push(
      gateFail(
        2,
        "EX-G1",
        "Compound impact+jira stays tools-only with jira tool",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  try {
    const decision = resolveChatIntentExecution(plan);
    assert.equal(decision.kind, "tools-only");
    if (decision.kind === "tools-only") {
      assert.ok(decision.tools.includes("jira"));
      assert.equal(decision.plan.workflow, undefined);
    }
    results.push(gatePass(2, "EX-G2", "Execution resolves to tools-only, not silent-workflow"));
  } catch (error) {
    results.push(
      gateFail(
        2,
        "EX-G2",
        "Execution resolves to tools-only, not silent-workflow",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  try {
    const status = buildIntentPlanStatusLine(plan);
    assert.match(status ?? "", /Jira/);
    assert.doesNotMatch(status ?? "", /change impact/);
    const activity = buildIntentPlanActivityMessages(plan);
    assert.ok(activity.some((line) => /Jira/i.test(line)));
    assert.ok(!activity.some((line) => /change impact/i.test(line)));
    results.push(gatePass(3, "EX-G3", "Trust status names Jira without Blast hijack"));
  } catch (error) {
    results.push(
      gateFail(
        3,
        "EX-G3",
        "Trust status names Jira without Blast hijack",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  assertAllGatesPass(results, "Example compound ask");
});

test("Ticket pickup + named symbol + Jira is locate, not tools-only codeIntent none (3b)", () => {
  const plan = planChatIntentFromRules({
    message:
      "I'm covering COOP-101 this week — peel auth into coop-backend. What in this repo still owns requireAuth, and what's the safest first extraction so we don't break every VS Code session?",
    connectedTools: ["jira"]
  });
  assert.ok(plan.tools.includes("jira"));
  assert.equal(plan.codeIntent?.action, "locate");
  assert.ok((plan.jobs ?? []).some((job) => job.capability === "locate"));
  assert.ok((plan.jobs ?? []).some((job) => job.capability === "decision"));
});

const I3_COMPOUND_ASK =
  "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?";

test("I3 compound ask plans locate requireAuth + peel-auth decision with slack+jira only", () => {
  const plan = planChatIntentFromRules({
    message: I3_COMPOUND_ASK,
    connectedTools: ["slack", "jira", "confluence", "notion", "google-docs"]
  });
  const capabilities = (plan.jobs ?? []).map((job) => job.capability);
  assert.ok(capabilities.includes("locate"));
  assert.ok(capabilities.includes("decision"));
  const locate = (plan.jobs ?? []).find((job) => job.capability === "locate")?.terms ?? [];
  const decision = (plan.jobs ?? []).find((job) => job.capability === "decision")?.terms ?? [];
  const decisionBlob = decision.join(" ").toLowerCase();
  assert.ok(locate.some((term) => /requireAuth/i.test(term)));
  assert.match(decisionBlob, /peel/);
  assert.match(decisionBlob, /coop-backend|coop backend/);
  assert.deepEqual(
    plan.tools.filter((tool) => tool === "confluence" || tool === "notion" || tool === "google-docs"),
    []
  );
  assert.ok(plan.tools.includes("slack") && plan.tools.includes("jira"));
});
