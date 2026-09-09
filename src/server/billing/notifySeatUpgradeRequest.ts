import { normalizeUserRole, type UserRecord } from "../users/userStore";
import type { UsageTier } from "../usageTiers";

export type SeatUpgradeNotifyResult = {
  adminCount: number;
  sent: number;
  failed: number;
  mocked: boolean;
};

export type SeatUpgradeNotifyEmail = {
  to: string;
  orgName: string;
  memberEmail: string;
  fromTier: UsageTier;
  toTier: UsageTier;
  reviewUrl: string;
};

function isActiveOrgAdmin(user: UserRecord): boolean {
  return !user.deactivatedAt && Boolean(user.email?.trim()) && normalizeUserRole(user.role) === "admin";
}

/**
 * Email every active admin/owner. One bad address must not block the rest.
 */
export async function notifyOrgAdminsOfSeatUpgradeRequest(input: {
  users: UserRecord[];
  send: (params: SeatUpgradeNotifyEmail) => Promise<{ mocked?: boolean } | void>;
  orgName: string;
  memberEmail: string;
  fromTier: UsageTier;
  toTier: UsageTier;
  reviewUrl: string;
}): Promise<SeatUpgradeNotifyResult> {
  const admins = input.users.filter(isActiveOrgAdmin);
  let sent = 0;
  let failed = 0;
  let mocked = false;
  for (const admin of admins) {
    try {
      const result = await input.send({
        to: admin.email,
        orgName: input.orgName,
        memberEmail: input.memberEmail,
        fromTier: input.fromTier,
        toTier: input.toTier,
        reviewUrl: input.reviewUrl
      });
      sent += 1;
      if (result?.mocked) {
        mocked = true;
      }
    } catch (error) {
      failed += 1;
      console.warn("[seat-upgrade] admin email failed:", admin.email, error);
    }
  }
  if (admins.length === 0) {
    console.warn("[seat-upgrade] no active admins to email");
  } else if (mocked) {
    console.warn("[seat-upgrade] emails mocked (COOP_EMAIL_MOCK or missing RESEND_API_KEY)");
  }
  return { adminCount: admins.length, sent, failed, mocked };
}
