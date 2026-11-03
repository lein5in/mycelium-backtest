import { cellIndex, type HeatmapGrid } from './types'

export type Rgb = readonly [number, number, number]

export const RANK_BREAKPOINTS = [0, 0.4, 0.7, 0.88, 0.955, 0.988, 1] as const

export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

export function rankPositions(values: readonly number[]): Float64Array {
  const positions = new Float64Array(values.length).fill(-1)
  const order = values
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => a.value - b.value)
  const highestRankOfValue = new Map<number, number>()
  order.forEach((entry, position) => highestRankOfValue.set(entry.value, position + 1))
  for (const entry of order) {
    positions[entry.index] = (highestRankOfValue.get(entry.value) ?? 0) / order.length
  }
  return positions
}

export function shapedPosition(rank: number): number {
  if (rank <= 0) return -1
  const stops = RANK_BREAKPOINTS.length - 1
  for (let stop = 1; stop <= stops; stop += 1) {
    const lower = RANK_BREAKPOINTS[stop - 1] ?? 0
    const upper = RANK_BREAKPOINTS[stop] ?? 1
    if (rank <= upper) return (stop - 1 + (rank - lower) / (upper - lower)) / stops
  }
  return 1
}

export function rampColor(position: number, ramp: readonly Rgb[]): Rgb {
  const clamped = Math.min(1, Math.max(0, position))
  const scaled = clamped * (ramp.length - 1)
  const lower = Math.floor(scaled)
  const upper = Math.min(ramp.length - 1, lower + 1)
  const t = scaled - lower
  const a = ramp[lower]
  const b = ramp[upper]
  if (!a || !b) return [0, 0, 0]
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

export function heatmapPixels(grid: HeatmapGrid, ramp: readonly Rgb[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(grid.columns * grid.rows * 4)
  const ranks = rankPositions(grid.intensity)
  for (let column = 0; column < grid.columns; column += 1) {
    for (let row = 0; row < grid.rows; row += 1) {
      const rank = ranks[cellIndex(grid, column, row)] ?? -1
      const offset = ((grid.rows - 1 - row) * grid.columns + column) * 4
      if (rank <= 0) continue
      const [r, g, b] = rampColor(shapedPosition(rank), ramp)
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = 255
    }
  }
  return pixels
}
