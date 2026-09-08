import assert from "node:assert/strict";
import { convertSeatInPlace, neverFilledSeats, stripeItemUpdatesForInventory } from "./seatInventory";

const prices = { pro: "price_pro", proPlus: "price_plus", max: "price_max" };

// Alice Pro → Max must not consume a spare empty Max.
const purchased = { pro: 8, pro_plus: 0, max: 2 };
const occupied = { pro: 8, pro_plus: 0, max: 1 };
const next = convertSeatInPlace(purchased, "pro", "max");
assert.deepEqual(next, { pro: 7, pro_plus: 0, max: 3 });
const occupiedAfter = { pro: 7, pro_plus: 0, max: 2 };
assert.deepEqual(neverFilledSeats(next, occupiedAfter), { pro: 0, pro_plus: 0, max: 1 });

const updates = stripeItemUpdatesForInventory(
  [
    { id: "si_pro", quantity: 8, priceId: "price_pro" },
    { id: "si_max", quantity: 2, priceId: "price_max" }
  ],
  next,
  prices
);
assert.deepEqual(updates, [
  { id: "si_pro", quantity: 7 },
  { id: "si_max", quantity: 3 }
]);

console.log("convertSeat: 1/1 tests passed");
