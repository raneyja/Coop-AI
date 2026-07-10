import type { OperatorRole, StoredOperatorMe } from "./auth";

export function canView(_me: StoredOperatorMe): boolean {
  return true;
}

export function canMutateSupport(me: StoredOperatorMe): boolean {
  return me.role === "support" || me.role === "billing" || me.role === "super_admin";
}

export function canMutateBilling(me: StoredOperatorMe): boolean {
  return me.role === "billing" || me.role === "super_admin";
}

export function canSuperAdmin(me: StoredOperatorMe): boolean {
  return me.role === "super_admin";
}

export function roleRank(role: OperatorRole): number {
  switch (role) {
    case "super_admin":
      return 4;
    case "billing":
      return 3;
    case "support":
      return 2;
    default:
      return 1;
  }
}

export function requiredRoleLabel(minRole: OperatorRole): string {
  switch (minRole) {
    case "super_admin":
      return "Super admin";
    case "billing":
      return "Billing or higher";
    case "support":
      return "Support or higher";
    default:
      return "Viewer";
  }
}
