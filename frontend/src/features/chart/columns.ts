import type { HeatmapGrid } from './types'

export type ColumnSpans = {
  first: Int32Array
  last: Int32Array
  uniform: boolean
}

export function columnSpans(grid: HeatmapGrid, times: ArrayLike<number>): ColumnSpans {
  const first = new Int32Array(grid.columns).fill(-1)
  const last = new Int32Array(grid.columns).fill(-1)
  const bucket = grid.time_bucket_seconds
  for (let bar = 0; bar < times.length; bar += 1) {
    const time = times[bar] ?? 0
    const column = Math.floor((time - grid.first_time) / bucket)
    if (column < 0 || column >= grid.columns) continue
    if (first[column] === -1) first[column] = bar
    last[column] = bar
  }
  let uniform = times.length > 0
  const offset = first[0] ?? -1
  for (let column = 0; column < grid.columns && uniform; column += 1) {
    uniform = first[column] === offset + column && last[column] === offset + column
  }
  return { first, last, uniform: uniform && offset >= 0 }
}

export function columnCenterBar(spans: ColumnSpans, column: number): number | null {
  const first = spans.first[column] ?? -1
  const last = spans.last[column] ?? -1
  if (first < 0 || last < 0) return null
  return (first + last) / 2
}

export function completedColumns(spans: ColumnSpans, cursor: number | null): number {
  if (cursor === null) return spans.first.length
  let count = 0
  for (let column = 0; column < spans.first.length; column += 1) {
    const last = spans.last[column] ?? -1
    if (last < 0) continue
    if (last > cursor) break
    count = column + 1
  }
  return count
}
