import { cellIndex, type HeatmapGrid } from './types'

export type ProfileRow = { buy: number; sell: number }

export type VolumeProfile = {
  rows: ProfileRow[]
  pocRow: number
  peak: number
}

export function buildVolumeProfile(
  grid: HeatmapGrid,
  fromColumn: number,
  toColumn: number,
): VolumeProfile {
  const first = Math.max(0, Math.floor(fromColumn))
  const last = Math.min(grid.columns - 1, Math.ceil(toColumn))
  const rows: ProfileRow[] = Array.from({ length: grid.rows }, () => ({ buy: 0, sell: 0 }))
  for (let column = first; column <= last; column += 1) {
    for (let row = 0; row < grid.rows; row += 1) {
      const index = cellIndex(grid, column, row)
      const volume = grid.intensity[index] ?? 0
      const ratio = grid.buy_ratio[index] ?? 0.5
      const target = rows[row]
      if (!target) continue
      target.buy += volume * ratio
      target.sell += volume * (1 - ratio)
    }
  }
  let pocRow = -1
  let peak = 0
  rows.forEach((row, index) => {
    const total = row.buy + row.sell
    if (total > peak) {
      peak = total
      pocRow = index
    }
  })
  return { rows, pocRow, peak }
}
