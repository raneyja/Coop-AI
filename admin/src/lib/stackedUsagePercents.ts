export function stackedUsagePercents(
  autoRatio: number,
  frontierRatio: number
): { auto: number; frontier: number } {
  const auto = Math.max(0, autoRatio) * 100;
  const frontier = Math.max(0, frontierRatio) * 100;
  const total = auto + frontier;
  if (total <= 100) {
    return { auto, frontier };
  }
  const scale = 100 / total;
  return { auto: auto * scale, frontier: frontier * scale };
}
