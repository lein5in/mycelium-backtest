import { describe, expect, it } from 'vitest'
import { heatmapPixels, parseHex, rampColor, rankPositions, shapedPosition } from './heatmapColor'
import type { HeatmapGrid } from './types'

const ramp = ['#04070b', '#07101c', '#0b2342', '#14406f', '#6a4313', '#b06d1c', '#e0a33f'].map(
  parseHex,
)

describe('heatmap colour mapping', () => {
  it('parses hex colours', () => {
    expect(parseHex('#e0a33f')).toEqual([224, 163, 63])
    expect(parseHex('#fff')).toEqual([255, 255, 255])
  })

  it('ranks non-zero values and leaves empty cells out', () => {
    const ranks = rankPositions([0, 5, 1, 5, 10])
    expect(ranks[0]).toBe(-1)
    expect(ranks[2]).toBeCloseTo(0.25)
    expect(ranks[1]).toBeCloseTo(0.75)
    expect(ranks[3]).toBeCloseTo(0.75)
    expect(ranks[4]).toBe(1)
  })

  it('keeps the median cell in the darkest stops of the ramp', () => {
    expect(shapedPosition(0.5)).toBeGreaterThan(1 / 6)
    expect(shapedPosition(0.5)).toBeLessThan(2 / 6)
    expect(shapedPosition(1)).toBe(1)
    expect(shapedPosition(0)).toBe(-1)
  })

  it('reserves the warm stops for the top five percent of cells', () => {
    expect(shapedPosition(0.95)).toBeLessThan(4 / 6)
    expect(shapedPosition(0.96)).toBeGreaterThan(4 / 6)
    expect(shapedPosition(0.4)).toBeCloseTo(1 / 6)
  })

  it('reaches the warm end only at the top rank', () => {
    expect(rampColor(1, ramp)).toEqual([224, 163, 63])
    expect(rampColor(0, ramp)).toEqual([4, 7, 11])
  })

  it('lays pixels out with the highest price row on top and empty cells transparent', () => {
    const grid: HeatmapGrid = {
      mode: 'ESTIMATED_FROM_CANDLES',
      time_bucket_seconds: 60,
      price_bucket: 1,
      columns: 2,
      rows: 2,
      first_time: 0,
      lowest_price: 100,
      intensity: [0, 1, 0.5, 0],
      buy_ratio: [0.5, 0.5, 0.5, 0.5],
    }
    const pixels = heatmapPixels(grid, ramp)
    const alphaAt = (x: number, y: number) => pixels[(y * 2 + x) * 4 + 3]
    expect(alphaAt(0, 0)).toBe(255)
    expect(alphaAt(0, 1)).toBe(0)
    expect(alphaAt(1, 1)).toBe(255)
    expect(alphaAt(1, 0)).toBe(0)
    expect([pixels[0], pixels[1], pixels[2]]).toEqual([224, 163, 63])
  })
})
