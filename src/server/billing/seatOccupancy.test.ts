import assert from "node:assert/strict";
import { namedSeatStatus, userOccupiesNamedSeat } from "./seatOccupancy";

const joined = new Date("2026-01-15T12:00:00Z");
const deactivatedAt = new Date("2026-02-01T12:00:00Z");

assert.equal(userOccupiesNamedSeat({ lastLoginAt: null, deactivatedAt: null }), true);
assert.equal(namedSeatStatus({ lastLoginAt: null, deactivatedAt: null }), "invited");

assert.equal(userOccupiesNamedSeat({ lastLoginAt: joined, deactivatedAt: null }), true);
assert.equal(namedSeatStatus({ lastLoginAt: joined, deactivatedAt: null }), "active");

assert.equal(userOccupiesNamedSeat({ lastLoginAt: joined, deactivatedAt }), true);
assert.equal(namedSeatStatus({ lastLoginAt: joined, deactivatedAt }), "deactivated");

assert.equal(userOccupiesNamedSeat({ lastLoginAt: null, deactivatedAt }), false);
assert.equal(namedSeatStatus({ lastLoginAt: null, deactivatedAt }), "deactivated");

console.log("seatOccupancy: 1/1 tests passed");
