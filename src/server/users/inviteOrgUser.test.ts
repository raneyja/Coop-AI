import assert from "node:assert/strict";
import {
  inviteOrgUser,
  isInviteUserConflictError,
  isSeatLimitError,
  resolveInviteTarget
} from "./inviteOrgUser";
import type { OrgStore } from "../orgStore";
import type { UserRecord, UserStore } from "./userStore";

function billing(inventory: { pro: number; pro_plus: number; max: number }) {
  return {
    getOrganizationBilling: async () => ({
      usageTier: "pro" as const,
      seatInventory: inventory,
      seatCount: inventory.pro + inventory.pro_plus + inventory.max
    }),
    getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "pro" as const, createdAt: new Date() })
  } as unknown as OrgStore;
}

function users(occupied: { pro: number; pro_plus: number; max: number }) {
  return {
    countOccupiedSeatsByTier: async () => occupied,
    createUser: async () => {
      throw new Error("createUser should not run");
    }
  } as unknown as UserStore;
}

const cancelled: UserRecord = {
  id: "user-1",
  orgId: "org-1",
  email: "bob@example.com",
  role: "member",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  deactivatedAt: new Date("2026-02-01T00:00:00Z")
};

void (async () => {
  const noMaxEmpty = await inviteOrgUser(
    { orgStore: billing({ pro: 10, pro_plus: 0, max: 0 }), userStore: users({ pro: 10, pro_plus: 0, max: 0 }) },
    { orgId: "org-1", email: "bob@example.com", usageTier: "max" }
  ).catch((caught: unknown) => caught);
  assert.equal(isSeatLimitError(noMaxEmpty), true);
  assert.equal((noMaxEmpty as Error & { usageTier?: string }).usageTier, "max");

  const deactivatedStillOccupies = await inviteOrgUser(
    { orgStore: billing({ pro: 9, pro_plus: 0, max: 1 }), userStore: users({ pro: 9, pro_plus: 0, max: 1 }) },
    { orgId: "org-1", email: "bob@example.com", usageTier: "max" }
  ).catch((caught: unknown) => caught);
  assert.equal(isSeatLimitError(deactivatedStillOccupies), true);

  const reopened = await resolveInviteTarget(
    {
      findOrgUserByEmail: async () => cancelled,
      reopenCancelledInvite: async () => ({ ...cancelled, deactivatedAt: undefined, usageTier: "pro" as const }),
      createUser: async () => {
        throw new Error("createUser should not run for a cancelled invite");
      }
    } as unknown as UserStore,
    { orgId: "org-1", email: "bob@example.com", role: "member", usageTier: "pro" }
  );
  assert.equal(reopened.deactivatedAt, undefined);
  assert.equal(reopened.email, "bob@example.com");

  const joinedConflict = await resolveInviteTarget(
    {
      findOrgUserByEmail: async () => ({
        ...cancelled,
        lastLoginAt: new Date("2026-01-15T00:00:00Z"),
        deactivatedAt: undefined
      }),
      createUser: async () => {
        throw new Error("createUser should not run");
      }
    } as unknown as UserStore,
    { orgId: "org-1", email: "bob@example.com", role: "member", usageTier: "pro" }
  ).catch((caught: unknown) => caught);
  assert.equal(isInviteUserConflictError(joinedConflict), true);
  if (isInviteUserConflictError(joinedConflict)) {
    assert.equal(joinedConflict.code, "already_on_team");
  }

  console.log("inviteOrgUser: 1/1 tests passed");
})();
