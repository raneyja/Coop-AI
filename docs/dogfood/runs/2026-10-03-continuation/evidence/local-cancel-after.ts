export function positiveSum(values: readonly number[]): number {
  let result = 0;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i]! > 0) result += values[i]!;
  }
  return result;
}
