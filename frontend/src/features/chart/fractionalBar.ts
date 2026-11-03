export function fractionalBarToX(barToX: (bar: number) => number | null, bar: number): number | null {
  const lower = Math.floor(bar)
  const lowerX = barToX(lower)
  const fraction = bar - lower
  if (lowerX === null || fraction === 0) return lowerX
  const upperX = barToX(lower + 1)
  return upperX === null ? lowerX : lowerX + (upperX - lowerX) * fraction
}
