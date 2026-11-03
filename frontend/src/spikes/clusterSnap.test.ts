import { describe, expect, it } from 'vitest'
import { snapRegionToCandles } from './clusterSnap'

const candles = [
  { time: 0, open: 10, high: 11, low: 9, close: 10.5, volume: 1 },
  { time: 1, open: 10.5, high: 12.5, low: 10, close: 12, volume: 1 },
  { time: 2, open: 12, high: 13, low: 8.5, close: 9, volume: 1 },
  { time: 3, open: 9, high: 9.5, low: 7, close: 7.5, volume: 1 },
]

describe('snapRegionToCandles', () => {
  it('replaces fractions with the low and high of the candles in the bar range', () => {
    const region = snapRegionToCandles(
      { startBar: 1, endBar: 2, priceLow: 0.1, priceHigh: 0.2, units: 'fraction', label: 'L' },
      candles,
    )
    expect(region).toEqual({ startBar: 1, endBar: 2, priceLow: 8.5, priceHigh: 13, units: 'price', label: 'L' })
  })

  it('clamps the bar range to the available candles', () => {
    const region = snapRegionToCandles(
      { startBar: 2, endBar: 40, priceLow: 0, priceHigh: 1, units: 'fraction', label: 'L' },
      candles,
    )
    expect(region.priceLow).toBe(7)
    expect(region.priceHigh).toBe(13)
  })

  it('leaves a region outside the data untouched', () => {
    const input = { startBar: 50, endBar: 60, priceLow: 0.2, priceHigh: 0.4, units: 'fraction' as const, label: 'L' }
    expect(snapRegionToCandles(input, candles)).toEqual(input)
  })
})
