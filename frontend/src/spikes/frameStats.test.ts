import { describe, expect, it } from 'vitest'
import { frameStats, probeRange } from './frameStats'

describe('frameStats', () => {
  it('summarises frame deltas', () => {
    const stats = frameStats([10, 20, 30, 40])
    expect(stats.frames).toBe(4)
    expect(stats.mean).toBe(25)
    expect(stats.p50).toBe(20)
    expect(stats.p95).toBe(40)
    expect(stats.max).toBe(40)
    expect(stats.over16).toBe(3)
    expect(stats.over33).toBe(1)
  })

  it('handles an empty sample', () => {
    expect(frameStats([]).p95).toBe(0)
  })

  it('sweeps both zoom widths and pan positions', () => {
    const widths = Array.from({ length: 100 }, (_, frame) => {
      const range = probeRange(frame, 100, 400)
      return range.to - range.from
    })
    expect(Math.min(...widths)).toBeLessThan(80)
    expect(Math.max(...widths)).toBeGreaterThan(390)
  })
})
