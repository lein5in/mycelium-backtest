import { describe, expect, it } from 'vitest'
import { solveTwoBone } from './ik'

const hip = { x: 0, y: 0 }
const body = { x: 0, y: -10 }
const forward = { x: 0, y: -1 }

describe('solveTwoBone', () => {
  it('reaches a target within reach with both segment lengths preserved', () => {
    const target = { x: 30, y: 10 }
    const { knee, foot, reached } = solveTwoBone(hip, target, 25, 20, body, forward)
    expect(reached).toBe(true)
    expect(foot.x).toBeCloseTo(30)
    expect(foot.y).toBeCloseTo(10)
    expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(25)
    expect(Math.hypot(foot.x - knee.x, foot.y - knee.y)).toBeCloseTo(20)
  })

  it('extends fully toward a target out of reach', () => {
    const { knee, foot, reached } = solveTwoBone(hip, { x: 100, y: 0 }, 25, 20, body, forward)
    expect(reached).toBe(false)
    expect(foot.x).toBeCloseTo(45)
    expect(foot.y).toBeCloseTo(0)
    expect(knee.x).toBeCloseTo(25)
    expect(knee.y).toBeCloseTo(0)
  })

  it('bends the knee outward, away from the body midline', () => {
    const rightHip = { x: 4, y: 0 }
    const target = { x: 4, y: 30 }
    const { knee } = solveTwoBone(rightHip, target, 25, 20, { x: 0, y: 0 }, { x: 0, y: -1 })
    expect(Math.abs(knee.x)).toBeGreaterThan(Math.abs(rightHip.x))
    expect(knee.x).toBeGreaterThan(4)
  })

  it('mirrors for a leg on the other side', () => {
    const leftHip = { x: -4, y: 0 }
    const { knee } = solveTwoBone(leftHip, { x: -4, y: 30 }, 25, 20, { x: 0, y: 0 }, { x: 0, y: -1 })
    expect(knee.x).toBeLessThan(-4)
  })

  it('leans the knee slightly forward when the leg points sideways', () => {
    const { knee } = solveTwoBone({ x: 4, y: 0 }, { x: 40, y: 0 }, 25, 20, { x: 0, y: 0 }, { x: 0, y: -1 })
    expect(knee.y).toBeLessThan(0)
  })

  it('handles a target sitting on the hip', () => {
    const { foot, knee } = solveTwoBone(hip, hip, 25, 20, body, forward)
    expect(Number.isFinite(foot.x) && Number.isFinite(knee.x)).toBe(true)
  })
})

function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`missing item ${index}`)
  return item
}

describe('resting stance', () => {
  it('never crosses the segments of two legs on the same side', async () => {
    const { createSpider, legJoints, restPosition } = await import('./spider')
    const spider = createSpider({ x: 0, y: 0 }, { length: 38.4, reach: 2.3, stepThreshold: 0.55, speed: 340 }, 0)
    spider.fold = 0
    for (const leg of spider.legs) leg.foot = restPosition(spider, leg.geometry)
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
      const side = (p: typeof a, q: typeof a, r: typeof a) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
      return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
    }
    for (const prefix of ['L', 'R']) {
      const legs = spider.legs.filter((leg) => leg.geometry.id.startsWith(prefix))
      for (let first = 0; first < legs.length; first += 1) {
        for (let second = first + 1; second < legs.length; second += 1) {
          const a = legJoints(spider, at(legs, first))
          const b = legJoints(spider, at(legs, second))
          for (const [p, q] of [[a.hip, a.knee], [a.knee, a.foot]] as const) {
            for (const [r, t] of [[b.hip, b.knee], [b.knee, b.foot]] as const) expect(cross(p, q, r, t)).toBe(false)
          }
        }
      }
      const knees = legs.map((leg) => legJoints(spider, leg).knee.x)
      expect(at(knees, 0)).toBeGreaterThan(at(knees, 1))
      expect(at(knees, 1)).toBeGreaterThan(at(knees, 2))
      expect(at(knees, 2)).toBeGreaterThan(at(knees, 3))
    }
  })
})
