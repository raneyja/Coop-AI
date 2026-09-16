import assert from "node:assert/strict";
import { openHitsByIds } from "./openHitsByIds";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

async function main(): Promise<void> {
  await test("opens chosen ids including hit 4, skips rank 1–3", async () => {
    const hits = [1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, title: `Hit ${n}` }));
    const opened: string[] = [];
    const result = await openHitsByIds({
      hits,
      ids: ["p4"],
      idOf: (hit) => hit.id,
      openOne: async (hit) => {
        opened.push(hit.id);
        return { ...hit, body: "full" };
      }
    });
    assert.deepEqual(opened, ["p4"]);
    assert.equal((result.find((hit) => hit.id === "p4") as { body?: string }).body, "full");
    assert.equal((result.find((hit) => hit.id === "p1") as { body?: string }).body, undefined);
  });

  await test("caps Opens at 3 and keeps the row if Open fails", async () => {
    const hits = [1, 2, 3, 4].map((n) => ({ id: `p${n}` }));
    const opened: string[] = [];
    const result = await openHitsByIds({
      hits,
      ids: ["p1", "p2", "p3", "p4"],
      idOf: (hit) => hit.id,
      openOne: async (hit) => {
        opened.push(hit.id);
        if (hit.id === "p2") {
          throw new Error("hang");
        }
        return { ...hit, body: "ok" };
      }
    });
    assert.deepEqual(opened, ["p1", "p2", "p3"]);
    assert.equal((result[1] as { body?: string }).body, undefined);
    assert.equal((result[0] as { body?: string }).body, "ok");
  });
}

void main().then(() => {
  console.log(`\nopenHitsByIds: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
});
