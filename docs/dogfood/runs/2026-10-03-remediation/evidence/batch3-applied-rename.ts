export function sumPositive(values: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] > 0) total += values[i];
  }
  return total;
}

export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {
  const authorizationHeader = headers.authorization ?? '';
  if (!authorizationHeader.startsWith('Bearer ')) return undefined;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token || undefined;
}
