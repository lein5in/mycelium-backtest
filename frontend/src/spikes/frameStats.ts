export type FrameStats = {
  frames: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
  over16: number
  over33: number
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

export function frameStats(deltas: number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b)
  const sum = deltas.reduce((total, value) => total + value, 0)
  return {
    frames: deltas.length,
    mean: deltas.length ? sum / deltas.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
    over16: deltas.filter((value) => value > 16.7).length,
    over33: deltas.filter((value) => value > 33.4).length,
  }
}

export function probeRange(frame: number, totalFrames: number, barCount: number) {
  const phase = frame / totalFrames
  const width = 60 + (barCount - 60) * (0.5 + 0.5 * Math.cos(phase * Math.PI * 4))
  const centre = barCount / 2 + (barCount / 3) * Math.sin(phase * Math.PI * 6)
  return { from: centre - width / 2, to: centre + width / 2 }
}
