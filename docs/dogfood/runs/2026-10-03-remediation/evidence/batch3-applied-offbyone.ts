export function sumPositive(values: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0) total += values[i];
  }
  return total;
}

export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token || undefined;
}
