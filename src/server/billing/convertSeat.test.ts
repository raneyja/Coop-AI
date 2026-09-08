import assert from "node:assert/strict";
import {
  convertSeatInPlace,
  neverFilledSeats,
  stripeItemUpdatesForInventory
} from "./seatInventory";
import {
  isStripeModeMismatch,
  mapStripeConvertError,
  SeatConvertError,
  STRIPE_MODE_MISMATCH_MESSAGE
} from "./convertSeat";

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

assert.equal(
  isStripeModeMismatch(
    "No such subscription: 'sub_1PqllA2eRbu2Kw7Okdmc0hUX'; a similar object exists in test mode, but a live mode key was used to make this request."
  ),
  true
);
assert.equal(isStripeModeMismatch("No such subscription: sub_missing"), false);

const mapped = mapStripeConvertError(
  new Error(
    "No such subscription: 'sub_test'; a similar object exists in test mode, but a live mode key was used to make this request."
  )
);
assert.equal(mapped.code, "stripe_mode_mismatch");
assert.equal(mapped.statusCode, 409);
assert.equal(mapped.message, STRIPE_MODE_MISMATCH_MESSAGE);
assert.equal(mapped.message.includes("similar object exists"), false);

const passthrough = mapStripeConvertError(new SeatConvertError("inventory_conflict", "nope", 409));
assert.equal(passthrough.code, "inventory_conflict");

console.log("convertSeat: 1/1 tests passed");
