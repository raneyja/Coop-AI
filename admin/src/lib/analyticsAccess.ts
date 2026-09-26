/** Organization analytics is for teams — hide until a second person joins. */
export function shouldShowOrganizationAnalytics(
  isAdmin: boolean,
  memberCount: number | null | undefined
): boolean {
  if (!isAdmin) {
    return false;
  }
  if (typeof memberCount !== "number" || !Number.isFinite(memberCount)) {
    return false;
  }
  return memberCount > 1;
}
