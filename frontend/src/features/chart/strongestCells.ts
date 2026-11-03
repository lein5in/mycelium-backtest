import { cellIndex, type HeatmapGrid } from './types'

export type StrongCell = { column: number; row: number; price: number; intensity: number }

export function strongestCells(grid: HeatmapGrid, count: number, minColumnGap: number): StrongCell[] {
  const candidates: StrongCell[] = []
  for (let column = 0; column < grid.columns; column += 1) {
    for (let row = 0; row < grid.rows; row += 1) {
      const intensity = grid.intensity[cellIndex(grid, column, row)] ?? 0
      if (intensity > 0) {
        candidates.push({
          column,
          row,
          price: grid.lowest_price + (row + 0.5) * grid.price_bucket,
          intensity,
        })
      }
    }
  }
  candidates.sort((a, b) => b.intensity - a.intensity || a.column - b.column)
  const picked: StrongCell[] = []
  for (const cell of candidates) {
    if (picked.length >= count) break
    if (picked.every((other) => Math.abs(other.column - cell.column) >= minColumnGap)) {
      picked.push(cell)
    }
  }
  return picked.sort((a, b) => a.column - b.column)
}
