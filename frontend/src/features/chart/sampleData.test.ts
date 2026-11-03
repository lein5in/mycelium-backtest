import { describe, expect, it } from 'vitest'
import { estimateGridFromCandles, generateSampleData } from './sampleData'
import { cellIndex } from './types'

describe('sample data generator', () => {
  it('is deterministic for a seed', () => {
    expect(generateSampleData()).toEqual(generateSampleData())
  })

  it('builds a 400 by 120 grid normalised to the 0 to 1 range', () => {
    const { grid, candles } = generateSampleData()
    expect(grid.columns).toBe(400)
    expect(grid.rows).toBe(120)
    expect(grid.intensity).toHaveLength(400 * 120)
    expect(Math.max(...grid.intensity)).toBe(1)
    expect(Math.min(...grid.intensity)).toBe(0)
    expect(grid.first_time).toBe(candles[0]?.time)
    expect(grid.mode).toBe('ESTIMATED_FROM_CANDLES')
  })

  it('spreads each bar volume only inside its high-low range', () => {
    const candles = [
      { time: 0, open: 10, high: 12, low: 10, close: 11, volume: 100 },
      { time: 60, open: 11, high: 14, low: 13, close: 13.5, volume: 50 },
    ]
    const grid = estimateGridFromCandles(candles, 4, 60)
    expect(grid.lowest_price).toBe(10)
    expect(grid.price_bucket).toBe(1)
    const column = (c: number) => [0, 1, 2, 3].map((row) => grid.intensity[cellIndex(grid, c, row)])
    expect(column(0)[2]).toBe(0)
    expect(column(0)[3]).toBe(0)
    expect(column(1)[0]).toBe(0)
    expect(column(1)[1]).toBe(0)
  })

  it('produces trades whose exits follow their entries', () => {
    const { trades, candles } = generateSampleData()
    expect(trades.length).toBeGreaterThan(5)
    for (const trade of trades) {
      expect(trade.exitBar).toBeGreaterThan(trade.entryBar)
      expect(trade.exitBar).toBeLessThan(candles.length)
    }
  })
})
