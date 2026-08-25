/**
 * End-to-end planner decision for the product example:
 * "help me understand which files will be impacted… check jira…"
 * Gate: silent blast-radius + jira tool allowlist.
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

test("Example ask: blast impact + Jira → silent workflow with tools (all phases)", () => {
  const results: GateResult[] = [];

  const plan = planChatIntentFromRules({
    message:
      "help me understand which files will be impacted if I make changes to this open file. Be sure to check jira for open tickets as well",
    activeFile: "src/chat/CoopChatSession.ts",
    connectedTools: ["jira", "slack"]
  });

  try {
    assert.equal(plan.workflow, "blast-radius");
    assert.deepEqual(plan.tools, ["jira"]);
    assert.equal(plan.execution, "silent");
    assert.equal(plan.mode, "run-workflow");
    results.push(
      gatePass(2, "EX-G1", "Compound blast+jira plans silent workflow with jira tool")
    );
  } catch (error) {
    results.push(
      gateFail(
        2,
        "EX-G1",
        "Compound blast+jira plans silent workflow with jira tool",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  try {
    const decision = resolveChatIntentExecution(plan);
    assert.equal(decision.kind, "silent-workflow");
    if (decision.kind === "silent-workflow") {
      assert.equal(decision.workflow, "blast-radius");
      assert.deepEqual(decision.tools, ["jira"]);
    }
    results.push(gatePass(2, "EX-G2", "Execution resolves to silent-workflow"));
  } catch (error) {
    results.push(
      gateFail(
        2,
        "EX-G2",
        "Execution resolves to silent-workflow",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  try {
    const status = buildIntentPlanStatusLine(plan);
    assert.equal(status, "Checking change impact + Jira");
    const activity = buildIntentPlanActivityMessages(plan);
    assert.ok(activity.some((line) => /change impact/i.test(line)));
    assert.ok(activity.some((line) => /Jira/i.test(line)));
    results.push(gatePass(3, "EX-G3", "Trust status names blast + Jira"));
  } catch (error) {
    results.push(
      gateFail(
        3,
        "EX-G3",
        "Trust status names blast + Jira",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  assertAllGatesPass(results, "Example compound ask");
});

test("Ticket pickup + named symbol + Jira is locate, not tools-only codeIntent none (3b)", () => {
  const plan = planChatIntentFromRules({
    message:
      "I'm picking up COOP-101 — peel auth into coop-backend. What in this repo still owns requireAuth / request auth, and what's the safest first extraction boundary so we don't break every VS Code session?",
    connectedTools: ["jira"]
  });
  assert.ok(plan.tools.includes("jira"));
  assert.equal(plan.codeIntent?.action, "locate");
});
