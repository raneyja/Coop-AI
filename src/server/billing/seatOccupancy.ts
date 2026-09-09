/**
 * Named-seat occupancy.
 *
 * - Sending an invite assigns that seat (it is not available for someone else).
 * - Deactivate before they join → seat is free again.
 * - After they join, deactivate does not free the seat.
 */

export type NamedSeatStatus = "active" | "invited" | "deactivated";

export function userOccupiesNamedSeat(user: {
  lastLoginAt?: Date | string | null;
  deactivatedAt?: Date | string | null;
}): boolean {
  if (user.lastLoginAt) {
    return true;
  }
  return !user.deactivatedAt;
}

export function namedSeatStatus(user: {
  lastLoginAt?: Date | string | null;
  deactivatedAt?: Date | string | null;
}): NamedSeatStatus {
  if (user.deactivatedAt) {
    return "deactivated";
  }
  if (user.lastLoginAt) {
    return "active";
  }
  return "invited";
}

/** Joined then deactivated — seat is still theirs; admin can turn sign-in back on. */
export function canReactivateNamedSeat(user: {
  lastLoginAt?: Date | string | null;
  deactivatedAt?: Date | string | null;
}): boolean {
  return Boolean(user.deactivatedAt) && Boolean(user.lastLoginAt);
}
