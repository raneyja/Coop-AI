import { adminPortalAcceptInviteUrl } from "../billing/adminPortalUrl";
import { loadBillingConfig } from "../billing/billingConfig";
import { EmailService } from "../email/emailService";
import type { AuthTokenStore } from "../auth/authTokenStore";
import type { OrgStore } from "../orgStore";
import type { UserRole, UserStore } from "../users/userStore";
import { neverFilledSeats, seatInventoryTotal } from "../billing/seatInventory";
import { displayUsageTierName, parseUsageTier, type UsageTier } from "../usageTiers";

export type InviteOrgUserDeps = {
  orgStore: OrgStore;
  userStore: UserStore;
  authTokenStore?: AuthTokenStore;
};

export type InviteOrgUserInput = {
  orgId: string;
  email: string;
  role?: UserRole;
  invitedByEmail?: string;
  repoIds?: string[];
  usageTier?: UsageTier;
};

export type InviteOrgUserResult = {
  user: {
    id: string;
    email: string;
    role: string;
    active: boolean;
    createdAt: Date;
  };
  inviteStatus: "created" | "email_failed";
  inviteToken?: string;
};

const USER_ROLES = new Set<UserRole>(["admin", "member"]);

export async function inviteOrgUser(
  deps: InviteOrgUserDeps,
  input: InviteOrgUserInput
): Promise<InviteOrgUserResult> {
  const email = input.email.trim();
  const role = (input.role ?? "admin") as UserRole;
  if (!email) {
    throw new Error("email is required");
  }
  if (!USER_ROLES.has(role)) {
    throw new Error("role must be admin or member");
  }

  const billing = await deps.orgStore.getOrganizationBilling(input.orgId);
  const inviteTier =
    parseUsageTier(input.usageTier) ?? parseUsageTier(billing?.usageTier) ?? "pro";
  const occupied = await deps.userStore.countOccupiedSeatsByTier(input.orgId);
  const purchased = billing?.seatInventory ?? occupied;
  const neverFilled = neverFilledSeats(purchased, occupied);
  if (neverFilled[inviteTier] < 1) {
    const error = new Error("seat_limit_reached");
    (error as Error & { code: string; seats: number; used: number; usageTier: UsageTier }).code =
      "seat_limit_reached";
    (error as Error & { seats: number }).seats = seatInventoryTotal(purchased);
    (error as Error & { used: number }).used = seatInventoryTotal(occupied);
    (error as Error & { usageTier: UsageTier }).usageTier = inviteTier;
    (error as Error & { message: string }).message =
      `No unused ${displayUsageTierName(inviteTier)} seat is available to invite into.`;
    throw error;
  }

  const user = await deps.userStore.createUser(input.orgId, email, role, inviteTier);
  const org = await deps.orgStore.getOrganization(input.orgId);
  const orgName = org?.name ?? "your organization";

  let inviteStatus: InviteOrgUserResult["inviteStatus"] = "created";
  let inviteToken: string | undefined;

  const billingConfig = loadBillingConfig();
  const emailService = new EmailService(billingConfig);
  try {
    if (!deps.authTokenStore) {
      throw new Error("auth token store not configured");
    }
    inviteToken = await deps.authTokenStore.createToken(
      user.id,
      "user_invite",
      7 * 24 * 60 * 60 * 1000,
      { orgName, invitedBy: input.invitedByEmail }
    );
    await emailService.sendInvite({
      to: email,
      orgName,
      acceptInviteUrl: adminPortalAcceptInviteUrl(billingConfig.adminPortalUrl, inviteToken),
      invitedBy: input.invitedByEmail
    });
  } catch (error) {
    console.warn("[invite] email failed:", error);
    inviteStatus = "email_failed";
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      active: !user.deactivatedAt,
      createdAt: user.createdAt
    },
    inviteStatus,
    inviteToken
  };
}

export function isSeatLimitError(
  error: unknown
): error is Error & { code: "seat_limit_reached"; seats: number; used: number } {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === "seat_limit_reached" &&
    typeof (error as Error & { seats?: number }).seats === "number"
  );
}
