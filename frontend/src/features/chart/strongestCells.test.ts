import { describe, expect, it } from 'vitest'
import { generateSampleData } from './sampleData'
import { strongestCells } from './strongestCells'
import type { HeatmapGrid } from './types'

describe('strongestCells', () => {
  it('picks the most intense cells with a minimum column gap, in column order', () => {
    const grid: HeatmapGrid = {
      mode: 'ESTIMATED_FROM_CANDLES',
      time_bucket_seconds: 60,
      price_bucket: 2,
      columns: 4,
      rows: 1,
      first_time: 0,
      lowest_price: 10,
      intensity: [0.9, 1, 0.2, 0.5],
      buy_ratio: [0.5, 0.5, 0.5, 0.5],
    }
    const cells = strongestCells(grid, 3, 2)
    expect(cells.map((cell) => cell.column)).toEqual([1, 3])
    expect(cells[0]?.price).toBe(11)
  })

  it('returns at most the requested count on the sample grid', () => {
    const { grid } = generateSampleData()
    const cells = strongestCells(grid, 12, 12)
    expect(cells).toHaveLength(12)
    expect(cells[0]?.intensity).toBeGreaterThan(0)
  })
})
