export function positiveSum(values: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > 0) total += values[i]!;
  }
  return total;
}

// Intervening dogfood edit: preserve this marker.
