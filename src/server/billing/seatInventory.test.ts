import assert from "node:assert/strict";
import {
  addSeatsToInventory,
  convertSeatInPlace,
  displaySeatMix,
  emptySeatInventory,
  homogeneousUsageTier,
  inventoryFromOrgColumns,
  isMixedSeatInventory,
  neverFilledSeats,
  parseStripeItemsToInventory,
  seatInventoryTotal,
  stripeItemUpdatesForInventory
} from "./seatInventory";

const prices = { pro: "price_pro", proPlus: "price_plus", max: "price_max" };

assert.deepEqual(emptySeatInventory(), { pro: 0, pro_plus: 0, max: 0 });
assert.equal(seatInventoryTotal({ pro: 8, pro_plus: 0, max: 2 }), 10);
assert.equal(isMixedSeatInventory({ pro: 8, pro_plus: 0, max: 2 }), true);
assert.equal(isMixedSeatInventory({ pro: 10, pro_plus: 0, max: 0 }), false);
assert.equal(homogeneousUsageTier({ pro: 10, pro_plus: 0, max: 0 }), "pro");
assert.equal(homogeneousUsageTier({ pro: 8, pro_plus: 0, max: 2 }), null);

assert.equal(displaySeatMix({ pro: 8, pro_plus: 0, max: 2 }), "Mixed (8 Pro · 2 Max)");
assert.equal(displaySeatMix({ pro: 10, pro_plus: 0, max: 0 }), "10 Pro");

const purchased = { pro: 8, pro_plus: 0, max: 2 };
const occupied = { pro: 8, pro_plus: 0, max: 1 };
assert.deepEqual(neverFilledSeats(purchased, occupied), { pro: 0, pro_plus: 0, max: 1 });

const converted = convertSeatInPlace(purchased, "pro", "max");
assert.deepEqual(converted, { pro: 7, pro_plus: 0, max: 3 });
assert.deepEqual(neverFilledSeats(converted, { pro: 7, pro_plus: 0, max: 2 }), {
  pro: 0,
  pro_plus: 0,
  max: 1
});

assert.throws(() => convertSeatInPlace({ pro: 0, pro_plus: 0, max: 1 }, "pro", "max"));

assert.deepEqual(
  parseStripeItemsToInventory(
    [
      { quantity: 9, priceId: "price_pro" },
      { quantity: 1, priceId: "price_max" }
    ],
    prices
  ),
  { pro: 9, pro_plus: 0, max: 1 }
);

assert.deepEqual(
  parseStripeItemsToInventory([{ quantity: 5, priceId: "price_plus" }], prices),
  { pro: 0, pro_plus: 5, max: 0 }
);

assert.deepEqual(
  inventoryFromOrgColumns({
    seatInventoryPro: 8,
    seatInventoryProPlus: 0,
    seatInventoryMax: 2,
    seatCount: 10,
    usageTier: "pro"
  }),
  { pro: 8, pro_plus: 0, max: 2 }
);

assert.deepEqual(
  inventoryFromOrgColumns({
    seatCount: 4,
    usageTier: "pro_plus"
  }),
  { pro: 0, pro_plus: 4, max: 0 }
);

assert.deepEqual(addSeatsToInventory({ pro: 8, pro_plus: 0, max: 2 }, "max", 1), {
  pro: 8,
  pro_plus: 0,
  max: 3
});

const stripeUpdates = stripeItemUpdatesForInventory(
  [
    { id: "si_pro", quantity: 8, priceId: "price_pro" },
    { id: "si_max", quantity: 2, priceId: "price_max" }
  ],
  { pro: 7, pro_plus: 0, max: 3 },
  prices
);
assert.deepEqual(stripeUpdates, [
  { id: "si_pro", quantity: 7 },
  { id: "si_max", quantity: 3 }
]);

const createMax = stripeItemUpdatesForInventory(
  [{ id: "si_pro", quantity: 10, priceId: "price_pro" }],
  { pro: 9, pro_plus: 0, max: 1 },
  prices
);
assert.deepEqual(createMax, [
  { id: "si_pro", quantity: 9 },
  { priceId: "price_max", quantity: 1 }
]);

const dropPro = stripeItemUpdatesForInventory(
  [
    { id: "si_pro", quantity: 1, priceId: "price_pro" },
    { id: "si_max", quantity: 1, priceId: "price_max" }
  ],
  { pro: 0, pro_plus: 0, max: 2 },
  prices
);
assert.deepEqual(dropPro, [
  { id: "si_pro", deleted: true },
  { id: "si_max", quantity: 2 }
]);

console.log("seatInventory: 1/1 tests passed");
