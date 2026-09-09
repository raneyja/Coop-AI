/** 1 purchased seat = solo billing chrome. 2+ seats = team. Seat count is the source of truth, not checkout intent. */

export function normalizeSeatCount(seats: number | null | undefined): number {
  return Math.max(1, Math.floor(Number(seats ?? 1) || 1));
}

export function isSoloSeatCount(seats: number | null | undefined): boolean {
  return normalizeSeatCount(seats) === 1;
}

export function billingPageSubtitle(solo: boolean): string {
  return solo ? "Plan and subscription." : "Plan, seats, and subscription management.";
}

export type BillingAccountRow = {
  label: string;
  value: string;
};

/** Solo hides the numeric seat metric; teams keep Seats. */
export function billingAccountRow(seats: number, solo: boolean): BillingAccountRow {
  if (solo) {
    return { label: "Account", value: "Just you" };
  }
  return { label: "Seats", value: String(seats) };
}

export type AddSeatsCopy = {
  title: string;
  body: string;
  inputLabel: string;
  cta: string;
  showReduceNote: boolean;
};

export function addSeatsCopy(options: {
  solo: boolean;
  currentSeats: number;
  addCount: number;
}): AddSeatsCopy {
  const currentSeats = normalizeSeatCount(options.currentSeats);
  const addCount = Math.max(0, Math.floor(Number(options.addCount) || 0));
  if (options.solo) {
    return {
      title: "Add a teammate",
      body: "You're the only person on this plan. Add a seat for someone else — you'll confirm and pay the prorated amount in Stripe, then invite them from Users.",
      inputLabel: "Seats to add",
      cta: addCount <= 1 ? "Add a teammate" : "Add seats",
      showReduceNote: false
    };
  }
  return {
    title: "Add seats",
    body: `You currently have ${currentSeats} seat${currentSeats === 1 ? "" : "s"}. Pick a plan and how many to add — you'll confirm and pay the prorated amount in Stripe. Unused seats stay available to invite later.`,
    inputLabel: "Seats to add",
    cta: "Add seats",
    showReduceNote: true
  };
}

export function seatMixLine(mix?: string | null): string | null {
  const value = mix?.trim();
  return value ? value : null;
}

function convertSeatDelta(fromUsd?: number, toUsd?: number): string {
  if (!Number.isFinite(fromUsd) || !Number.isFinite(toUsd)) {
    return ", prorated in Stripe";
  }
  const delta = (toUsd as number) - (fromUsd as number);
  const signed = delta >= 0 ? `+$${delta}` : `-$${Math.abs(delta)}`;
  return ` (${signed}/mo, prorated in Stripe)`;
}

export function convertSeatPreview(fromName: string, toName: string, fromUsd?: number, toUsd?: number): string {
  return `Convert this person's seat from ${fromName} to ${toName}${convertSeatDelta(fromUsd, toUsd)}.`;
}

export function convertSeatModalCopy(options: {
  fromName: string;
  toName: string;
  fromUsd?: number;
  toUsd?: number;
  memberEmail?: string;
}): { title: string; body: string; confirmLabel: string; cancelLabel: string } {
  const whose = options.memberEmail?.trim()
    ? `${options.memberEmail.trim()}'s seat`
    : "this person's seat";
  return {
    title: "Convert this seat",
    body: `Convert ${whose} from ${options.fromName} to ${options.toName}${convertSeatDelta(options.fromUsd, options.toUsd)}.`,
    confirmLabel: "Convert",
    cancelLabel: "Cancel"
  };
}

export function upgradeRequestNoticeCopy(options: {
  memberEmail?: string;
  toName: string;
  otherPendingCount: number;
}): { heading: string; body: string } {
  const who = options.memberEmail?.trim() || "A teammate";
  const extra =
    options.otherPendingCount > 0
      ? ` ${options.otherPendingCount} more request${options.otherPendingCount === 1 ? " is" : "s are"} still open.`
      : "";
  return {
    heading: options.otherPendingCount > 0 ? "Upgrade requests" : "Upgrade request",
    body: `${who} asked to convert their seat to ${options.toName}.${extra}`
  };
}

export function newSeatTotalPreview(currentSeats: number, addCount: number): string | null {
  if (!Number.isFinite(addCount) || addCount < 1) {
    return null;
  }
  const total = normalizeSeatCount(currentSeats) + Math.floor(addCount);
  return `New total after confirm: ${total} seat${total === 1 ? "" : "s"}.`;
}

export function upgradeSeatCountNote(solo: boolean, nextName: string): string {
  return solo
    ? `Opens Stripe so you can switch to ${nextName}. Your seat stays the same.`
    : `Opens Stripe so you can switch to ${nextName}. Seat count stays the same.`;
}

export function usersPageSubtitle(options: { free: boolean; solo: boolean }): string {
  if (options.free) {
    return "Free plan is individual only — upgrade to Pro to invite teammates.";
  }
  if (options.solo) {
    return "Just you for now. Add a teammate from Billing when you're ready.";
  }
  return "Manage team members, each person's plan, and access. Seats stay with the person.";
}

export type UsersSeatsPanelCopy = {
  heading: string;
  assignedLine: { used: string; of: string; total: string; suffix: string } | null;
  justYou: boolean;
  hint: string;
};

export function usersSeatsPanelCopy(options: {
  free: boolean;
  solo: boolean;
  seats: number;
  seatsUsed: number;
  seatsAvailable: number;
  atCapacity: boolean;
}): UsersSeatsPanelCopy {
  const seats = normalizeSeatCount(options.seats);
  if (options.solo && !options.free) {
    return {
      heading: "Account",
      assignedLine: null,
      justYou: true,
      hint: options.atCapacity
        ? "To invite someone, add a seat in Billing first."
        : `${options.seatsAvailable} seat${options.seatsAvailable === 1 ? "" : "s"} available`
    };
  }
  return {
    heading: "Seats",
    assignedLine: {
      used: String(options.seatsUsed),
      of: " of ",
      total: String(seats),
      suffix: " occupied"
    },
    justYou: false,
    hint: options.atCapacity
      ? "No unused seats left — add seats in Billing first. People who have joined keep their seat if deactivated. Cancel an unused invite to free that seat."
      : `${options.seatsAvailable} unused ${options.seatsAvailable === 1 ? "seat" : "seats"} available to invite`
  };
}

export type UsersBillingLink = {
  label: string;
  emphasized: boolean;
};

export function usersBillingLink(options: {
  free: boolean;
  solo: boolean;
  atCapacity: boolean;
}): UsersBillingLink {
  if (options.free) {
    return { label: "Upgrade for team seats →", emphasized: false };
  }
  if (options.solo && options.atCapacity) {
    return { label: "Manage billing →", emphasized: false };
  }
  if (options.atCapacity) {
    return { label: "Add seats", emphasized: true };
  }
  return { label: "Manage billing →", emphasized: false };
}

export function usersInviteDisabledTitle(solo: boolean): string {
  return solo
    ? "Add a seat in Billing before inviting a teammate."
    : "All named seats are occupied — add seats in Billing first.";
}

export function usersRepoAccessHint(options: { solo: boolean; perUserAccess: boolean }): string {
  if (options.perUserAccess) {
    return "Assign repos when inviting, or with Manage repos on each user row.";
  }
  if (options.solo) {
    return "Your Deep-Indexed repos show up in the extension. This stays true if you add teammates later.";
  }
  return "Every team member automatically sees all Deep-Indexed repos in the extension.";
}
