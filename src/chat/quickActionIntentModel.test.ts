import assert from "node:assert/strict";
import {
  buildIntentSuggestUserMessage,
  classifyQuickActionIntent,
  parseIntentSuggestResponse,
  resolveIntentSuggestModel,
  shouldOfferFromModelClassification,
  type IntentSuggestCompleteFn
} from "./quickActionIntentModel";
import { suggestQuickActions } from "./quickActionSuggestIntent";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function main(): Promise<void> {
  await test("assignment: intentSuggest is gpt-4o-mini / openai", () => {
    const model = resolveIntentSuggestModel();
    assert.equal(model.provider, "openai");
    assert.equal(model.model, "gpt-4o-mini");
  });

  await test("parse: clean JSON", () => {
    const got = parseIntentSuggestResponse('{"action":"blast-radius","confidence":"high"}');
    assert.deepEqual(got, { action: "blast-radius", confidence: "high" });
  });

  await test("parse: fenced JSON + prose noise", () => {
    const got = parseIntentSuggestResponse(
      'Sure.\n```json\n{"action":"find-owner","confidence":"medium"}\n```\n'
    );
    assert.deepEqual(got, { action: "find-owner", confidence: "medium" });
  });

  await test("parse: invalid → none/low (fail-open)", () => {
    assert.deepEqual(parseIntentSuggestResponse(""), { action: "none", confidence: "low" });
    assert.deepEqual(parseIntentSuggestResponse("not json"), {
      action: "none",
      confidence: "low"
    });
    assert.deepEqual(parseIntentSuggestResponse('{"action":"edit","confidence":"high"}'), {
      action: "none",
      confidence: "low"
    });
    assert.deepEqual(
      parseIntentSuggestResponse('{"action":"blast-radius","confidence":"maybe"}'),
      {
        action: "none",
        confidence: "low"
      }
    );
  });

  await test("shouldOffer: none/low rejected; medium/high accepted", () => {
    assert.equal(
      shouldOfferFromModelClassification({ action: "none", confidence: "high" }),
      false
    );
    assert.equal(
      shouldOfferFromModelClassification({ action: "blast-radius", confidence: "low" }),
      false
    );
    assert.equal(
      shouldOfferFromModelClassification({ action: "blast-radius", confidence: "medium" }),
      true
    );
  });

  await test("regex: estimate impact of changing → blast (not soft-dialed)", () => {
    const result = suggestQuickActions("Estimate the impact of changing this code.");
    assert.equal(result.confidence, "high");
    assert.equal(result.suggestions[0]?.actionId, "blast-radius");
  });

  await test("user message includes optional active file", () => {
    assert.match(
      buildIntentSuggestUserMessage("Who owns this?", { activeFile: "src/a.ts" }),
      /Active file: src\/a\.ts/
    );
    assert.match(buildIntentSuggestUserMessage("hi"), /Reply with ONLY a JSON object/);
  });

  await test("classify: golden mocked responses", async () => {
    const golden: Array<{ ask: string; response: string; expectAction: string | undefined }> = [
      {
        ask: "Estimate the impact of changing this code.",
        response: '{"action":"blast-radius","confidence":"high"}',
        expectAction: "blast-radius"
      },
      {
        ask: "What does this file do, and who calls it?",
        response: '{"action":"none","confidence":"high"}',
        expectAction: undefined
      },
      {
        ask: "Who owns signing-request email delivery?",
        response: '{"action":"find-owner","confidence":"high"}',
        expectAction: "find-owner"
      },
      {
        ask: "What does this function return?",
        response: '{"action":"none","confidence":"medium"}',
        expectAction: undefined
      }
    ];

    for (const row of golden) {
      const complete: IntentSuggestCompleteFn = async () => row.response;
      const offer = await classifyQuickActionIntent(row.ask, complete);
      if (row.expectAction === undefined) {
        assert.equal(offer, undefined, `ask=${row.ask}`);
      } else {
        assert.ok(offer, `ask=${row.ask}`);
        assert.equal(offer!.suggestions[0]?.actionId, row.expectAction);
      }
    }
  });

  await test("classify: complete throws → undefined (fail-open)", async () => {
    const complete: IntentSuggestCompleteFn = async () => {
      throw new Error("network");
    };
    assert.equal(await classifyQuickActionIntent("Who owns this?", complete), undefined);
  });

  await test("classify: timeout → undefined (fail-open)", async () => {
    const complete: IntentSuggestCompleteFn = async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 500);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          },
          { once: true }
        );
      });
      return '{"action":"blast-radius","confidence":"high"}';
    };
    assert.equal(
      await classifyQuickActionIntent("Estimate the impact of changing this code.", complete, {
        timeoutMs: 20
      }),
      undefined
    );
  });

  console.log(`quickActionIntentModel: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
