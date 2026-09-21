/** Status copy that does not name a real read, search, or tool fetch. */
export function isTheaterActivityLabel(message: string): boolean {
  const trimmed = message.trim();
  return (
    /^Gathering workspace context/i.test(trimmed) ||
    /^Gathering deeper repo context/i.test(trimmed) ||
    /^Updating lightweight context/i.test(trimmed) ||
    /^Gathering integration context/i.test(trimmed) ||
    /^Searching indexed codebase/i.test(trimmed) ||
    /^Preparing blast-radius/i.test(trimmed) ||
    /^Building impact context/i.test(trimmed) ||
    /^Checking related symbols/i.test(trimmed) ||
    /^Fetching context/i.test(trimmed)
  );
}
