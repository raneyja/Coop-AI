import { planLabel, type CustomerSummary } from "./coopApi";

export const CUSTOMER_SORT_COLUMNS = [
  "name",
  "plan",
  "billing",
  "seats",
  "usage",
  "billed",
  "cost",
  "margin",
  "status",
  "created"
] as const;

export type CustomerSortColumn = (typeof CUSTOMER_SORT_COLUMNS)[number];
export type CustomerSortOrder = "asc" | "desc";

export function parseCustomerSort(
  sort: string | null,
  order: string | null
): { column: CustomerSortColumn; order: CustomerSortOrder } {
  if (sort === "usage" && order !== "asc") {
    return { column: "usage", order: "desc" };
  }
  const column = (CUSTOMER_SORT_COLUMNS as readonly string[]).includes(sort ?? "")
    ? (sort as CustomerSortColumn)
    : "name";
  return { column, order: order === "desc" ? "desc" : "asc" };
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function statusLabel(org: CustomerSummary): string {
  if (org.operatorStatus === "cancelled") return "cancelled";
  if (org.operatorStatus === "suspended") return "suspended";
  if (org.onboardingIncomplete) return "onboarding";
  return "active";
}

function sortValue(org: CustomerSummary, column: CustomerSortColumn): string | number | null {
  switch (column) {
    case "name":
      return text(org.name);
    case "plan":
      return text(planLabel(org.plan, org.seats));
    case "billing":
      return text(org.billingStatus);
    case "seats":
      return org.seats ?? null;
    case "usage":
      return org.usage?.usedRatio ?? null;
    case "billed":
      return org.usage?.seatRevenueCents ?? null;
    case "cost":
      return org.usage?.usedCents ?? null;
    case "margin":
      return org.usage?.marginCents ?? null;
    case "status":
      return statusLabel(org);
    case "created": {
      if (!org.createdAt) return null;
      const time = Date.parse(org.createdAt);
      return Number.isNaN(time) ? null : time;
    }
  }
}

function compareValues(a: string | number | null, b: string | number | null, order: CustomerSortOrder): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const delta = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return order === "desc" ? -delta : delta;
}

export function sortCustomers(
  organizations: CustomerSummary[],
  column: CustomerSortColumn,
  order: CustomerSortOrder
): CustomerSummary[] {
  return [...organizations].sort((a, b) => {
    const delta = compareValues(sortValue(a, column), sortValue(b, column), order);
    if (delta !== 0) return delta;
    return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
  });
}
