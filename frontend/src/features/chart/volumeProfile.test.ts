import { describe, expect, it } from 'vitest'
import type { HeatmapGrid } from './types'
import { buildVolumeProfile } from './volumeProfile'

const grid: HeatmapGrid = {
  mode: 'ESTIMATED_FROM_CANDLES',
  time_bucket_seconds: 60,
  price_bucket: 1,
  columns: 3,
  rows: 2,
  first_time: 0,
  lowest_price: 0,
  intensity: [0.2, 0.4, 1, 0, 0.6, 0.2],
  buy_ratio: [1, 0.5, 0.25, 0.5, 0.5, 0],
}

describe('buildVolumeProfile', () => {
  it('splits each row into buy and sell volume over the column range', () => {
    const profile = buildVolumeProfile(grid, 0, 2)
    expect(profile.rows[0]?.buy).toBeCloseTo(0.2 + 0.25 + 0.3)
    expect(profile.rows[0]?.sell).toBeCloseTo(0 + 0.75 + 0.3)
    expect(profile.rows[1]?.buy).toBeCloseTo(0.2 + 0 + 0)
    expect(profile.rows[1]?.sell).toBeCloseTo(0.2 + 0 + 0.2)
    expect(profile.pocRow).toBe(0)
    expect(profile.peak).toBeCloseTo(1.8)
  })

  it('clamps the column range to the grid', () => {
    const profile = buildVolumeProfile(grid, -10, 0)
    expect(profile.rows[1]?.buy).toBeCloseTo(0.2)
    expect(profile.pocRow).toBe(1)
  })

  it('reports no POC when the range is empty of volume', () => {
    const empty = { ...grid, intensity: grid.intensity.map(() => 0) }
    expect(buildVolumeProfile(empty, 0, 2).pocRow).toBe(-1)
  })
})
