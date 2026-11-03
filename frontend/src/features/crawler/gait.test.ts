import { describe, expect, it } from 'vitest'
import { LEG_IDS, legSet, planSwings, SET_A, SET_B, snapFoot, type LegId } from './gait'
import { createSpider, liftedLegs, moveBody, stepLegs } from './spider'

describe('gait sets', () => {
  it('uses the alternating tetrapod sets from DESIGN 7.2', () => {
    expect([...SET_A]).toEqual(['L1', 'R2', 'L3', 'R4'])
    expect([...SET_B]).toEqual(['R1', 'L2', 'R3', 'L4'])
    expect(LEG_IDS.filter((id) => legSet(id) === 'A')).toHaveLength(4)
  })
})

describe('planSwings', () => {
  it('starts nothing while a leg is in the air', () => {
    const plan = planSwings(new Set<LegId>(['L1', 'R1']), new Set<LegId>(['L2']), 'A')
    expect(plan.start).toEqual([])
  })

  it('starts only legs from one set', () => {
    const plan = planSwings(new Set<LegId>(['L1', 'R1', 'L2', 'R2']), new Set(), 'B')
    expect(plan.set).toBe('A')
    expect(plan.start.every((id) => legSet(id) === 'A')).toBe(true)
  })

  it('alternates sets when both want to step equally', () => {
    const all = new Set<LegId>(LEG_IDS)
    expect(planSwings(all, new Set(), 'A').set).toBe('B')
    expect(planSwings(all, new Set(), 'B').set).toBe('A')
  })

  it('does nothing when no leg wants to step', () => {
    expect(planSwings(new Set(), new Set(), 'A')).toEqual({ set: null, start: [] })
  })
})

describe('snapFoot', () => {
  const nodes = [
    { x: 10, y: 0 },
    { x: 4, y: 3 },
    { x: 50, y: 50 },
  ]

  it('snaps to the nearest node within the radius', () => {
    expect(snapFoot({ x: 0, y: 0 }, nodes, 8)).toEqual({ x: 4, y: 3 })
  })

  it('keeps the ground point when no node is close enough', () => {
    expect(snapFoot({ x: 30, y: -30 }, nodes, 8)).toEqual({ x: 30, y: -30 })
  })
})

describe('walking spider', () => {
  it('never lifts more than four legs, keeps four planted and alternates sets', () => {
    const spider = createSpider({ x: 100, y: 100 }, { length: 24, reach: 2.3, stepThreshold: 0.55, speed: 220 }, 0)
    spider.fold = 0
    spider.foldTarget = 0
    spider.target = { x: 900, y: 140 }
    const waves: string[] = []
    let previous = ''
    for (let frame = 0; frame < 300; frame += 1) {
      const now = frame * 16
      moveBody(spider, 0.016)
      stepLegs(spider, { now, dt: 0.016, footholds: [], snapRadius: 0 })
      const lifted = liftedLegs(spider, now)
      expect(lifted.size).toBeLessThanOrEqual(4)
      expect(LEG_IDS.length - lifted.size).toBeGreaterThanOrEqual(4)
      const sets = new Set([...lifted].map(legSet))
      expect(sets.size).toBeLessThanOrEqual(1)
      const current = [...sets][0] ?? ''
      if (current && current !== previous) waves.push(current)
      if (current) previous = current
    }
    expect(waves.length).toBeGreaterThan(6)
    const alternations = waves.slice(1).filter((set, index) => set !== waves[index]).length
    expect(alternations).toBe(waves.length - 1)
  })

  it('keeps planted feet within leg reach even when the body is dragged fast', () => {
    const spider = createSpider({ x: 0, y: 0 }, { length: 24, reach: 2.3, stepThreshold: 0.55, speed: 220 }, 0)
    spider.fold = 0
    spider.foldTarget = 0
    spider.tempo = 4
    spider.target = { x: 2000, y: 0 }
    for (let frame = 0; frame < 120; frame += 1) {
      moveBody(spider, 0.016)
      stepLegs(spider, { now: frame * 16, dt: 0.016, footholds: [], snapRadius: 0 })
      for (const leg of spider.legs) {
        expect(Math.hypot(leg.foot.x - spider.x, leg.foot.y - spider.y)).toBeLessThan(spider.reach * spider.length + spider.length)
      }
    }
  })
})
