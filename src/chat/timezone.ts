/** Default for new users and unset preference — US Pacific. */
export const DEFAULT_TIMEZONE_ID = "America/Los_Angeles";

export type TimezoneOption = {
  id: string;
  label: string;
};

export const US_TIMEZONE_OPTIONS: TimezoneOption[] = [
  { id: "America/Los_Angeles", label: "PST" },
  { id: "America/Denver", label: "MST" },
  { id: "America/Chicago", label: "CST" },
  { id: "America/New_York", label: "EST" },
  { id: "America/Anchorage", label: "AKST" },
  { id: "Pacific/Honolulu", label: "HST" }
];

export const EUROPE_TIMEZONE_DEFS: Array<{ id: string; city: string }> = [
  { id: "Europe/London", city: "London" },
  { id: "Europe/Dublin", city: "Dublin" },
  { id: "Europe/Paris", city: "Paris" },
  { id: "Europe/Berlin", city: "Berlin" },
  { id: "Europe/Amsterdam", city: "Amsterdam" },
  { id: "Europe/Rome", city: "Rome" },
  { id: "Europe/Madrid", city: "Madrid" },
  { id: "Europe/Athens", city: "Athens" },
  { id: "Europe/Helsinki", city: "Helsinki" }
];

const SUPPORTED_TIMEZONE_IDS = new Set([
  ...US_TIMEZONE_OPTIONS.map((option) => option.id),
  ...EUROPE_TIMEZONE_DEFS.map((option) => option.id)
]);

export function formatEuropeanTimezoneLabel(
  timezoneId: string,
  city: string,
  referenceDate = new Date()
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezoneId,
      timeZoneName: "shortOffset"
    }).formatToParts(referenceDate);
    const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const offset = raw.replace(/^UTC/i, "GMT");
    return `${offset} — ${city}`;
  } catch {
    return city;
  }
}

export function listEuropeanTimezoneOptions(referenceDate = new Date()): TimezoneOption[] {
  return EUROPE_TIMEZONE_DEFS.map(({ id, city }) => ({
    id,
    label: formatEuropeanTimezoneLabel(id, city, referenceDate)
  }));
}

export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIMEZONE_ID;
  }
}

/** Resolve stored preference to an IANA id for formatting (defaults to Pacific). */
export function resolveTimezone(stored: string | undefined): string {
  return resolveTimezonePreference(stored);
}

/** Resolve stored preference to a supported timezone id (defaults to Pacific). */
export function resolveTimezonePreference(stored: string | undefined): string {
  const trimmed = stored?.trim();
  if (trimmed && SUPPORTED_TIMEZONE_IDS.has(trimmed)) {
    return trimmed;
  }
  return DEFAULT_TIMEZONE_ID;
}

export function formatTimeInTimezone(
  iso: string,
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" }
): string | undefined {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    return undefined;
  }
  try {
    return parsed.toLocaleString(undefined, { ...options, timeZone: resolveTimezone(timezone) });
  } catch {
    return undefined;
  }
}
