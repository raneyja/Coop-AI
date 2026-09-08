import assert from "node:assert/strict";
import { inviteOrgUser, isSeatLimitError } from "./inviteOrgUser";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "./userStore";

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

  console.log("inviteOrgUser: 1/1 tests passed");
})();
