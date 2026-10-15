/** Limit sign-in responses to the fields the portal actually uses. */
export function publicSessionProfile(data: Record<string, unknown>): Record<string, unknown> {
  const fields = [
    "orgId", "orgName", "plan", "role", "userId", "firstName", "lastName", "timezone",
    "memberOnboardingCompleted", "canInstallIntegrations", "email", "authMethod",
    "sessionProvider", "usageTier", "seats"
  ] as const;
  const profile: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(data, field)) profile[field] = data[field];
  }
  return profile;
}
