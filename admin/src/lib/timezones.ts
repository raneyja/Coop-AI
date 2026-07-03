export type TimezoneOption = {
  value: string;
  label: string;
};

/** Curated IANA zones for signup — browser default is prepended when supported. */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { value: "America/Denver", label: "Mountain Time (US & Canada)" },
  { value: "America/Chicago", label: "Central Time (US & Canada)" },
  { value: "America/New_York", label: "Eastern Time (US & Canada)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Vancouver", label: "Vancouver" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Amsterdam", label: "Amsterdam" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Rome", label: "Rome" },
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "Europe/Warsaw", label: "Warsaw" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Seoul", label: "Seoul" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Australia/Melbourne", label: "Melbourne" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "UTC", label: "UTC" }
];

export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function timezoneOptionsWithDefault(): TimezoneOption[] {
  const detected = detectBrowserTimezone();
  const inList = TIMEZONE_OPTIONS.some((option) => option.value === detected);
  if (inList) {
    return TIMEZONE_OPTIONS;
  }
  return [{ value: detected, label: `${detected} (your device)` }, ...TIMEZONE_OPTIONS];
}

export function displayName(firstName?: string, lastName?: string, email?: string): string {
  const full = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (full) {
    return full;
  }
  return email?.split("@")[0] ?? "there";
}
