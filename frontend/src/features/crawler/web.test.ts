import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../lib/random'
import { MAX_ACTIVE_LINKS, MAX_LINK_ALPHA, MAX_LINKS, MIN_LINK_ALPHA } from './params'
import {
  activeLinkTarget,
  applyLinks,
  chooseLinks,
  fadeLinks,
  linkAlpha,
  scaledThreshold,
  seedAmbient,
  type WebLink,
} from './web'

function scatter(count: number, width: number, height: number, seed = 3) {
  const random = mulberry32(seed)
  return Array.from({ length: count }, (_, index) => ({ id: `n${index}`, x: random() * width, y: random() * height }))
}

const options = (targetCount: number) => ({ targetCount, maxDegree: 5, attractor: null, random: mulberry32(9) })

describe('seedAmbient', () => {
  it('spreads nodes evenly over the plot instead of clumping', () => {
    const nodes = seedAmbient(1, 60)
    expect(nodes).toHaveLength(60)
    const quadrants = new Map<number, number>()
    for (const node of nodes) {
      expect(node.u).toBeGreaterThanOrEqual(0)
      expect(node.u).toBeLessThanOrEqual(1)
      const quadrant = (node.u < 0.5 ? 0 : 1) + (node.v < 0.5 ? 0 : 2)
      quadrants.set(quadrant, (quadrants.get(quadrant) ?? 0) + 1)
    }
    for (const quadrant of [0, 1, 2, 3]) expect(quadrants.get(quadrant) ?? 0).toBeGreaterThanOrEqual(10)
  })

  it('is deterministic for a seed', () => {
    expect(seedAmbient(4, 50).map((n) => n.u)).toEqual(seedAmbient(4, 50).map((n) => n.u))
  })
})

describe('chooseLinks', () => {
  it('never returns a link longer than the threshold', () => {
    const nodes = scatter(80, 1000, 650)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const link of chooseLinks(nodes, 140, options(80))) {
      const a = byId.get(link.a)
      const b = byId.get(link.b)
      expect(a && b && Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(140)
    }
  })

  it('respects the active link cap and the requested count', () => {
    const dense = scatter(90, 300, 200)
    expect(chooseLinks(dense, 160, options(500)).length).toBeLessThanOrEqual(MAX_ACTIVE_LINKS)
    expect(chooseLinks(dense, 160, options(40)).length).toBeLessThanOrEqual(40)
  })

  it('gives closer pairs a higher strength', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 20, y: 0 },
      { id: 'c', x: 0, y: 100 },
    ]
    const links = chooseLinks(nodes, 140, options(10))
    const strength = (x: string, y: string) =>
      links.find((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x))?.strength ?? -1
    expect(strength('a', 'b')).toBeGreaterThan(strength('a', 'c'))
    expect(strength('a', 'b')).toBeCloseTo(1 - 20 / 140)
  })

  it('connects every node that has a neighbour within the threshold', () => {
    const nodes = scatter(60, 900, 600, 11)
    const links = chooseLinks(nodes, 160, options(70))
    const linked = new Set(links.flatMap((l) => [l.a, l.b]))
    const reachable = nodes.filter((n) => nodes.some((m) => m !== n && Math.hypot(m.x - n.x, m.y - n.y) <= 160))
    expect(reachable.filter((n) => !linked.has(n.id)).length).toBeLessThanOrEqual(2)
  })
})

describe('applyLinks and fading', () => {
  it('fades new links in and dropped links out, and caps stored links at 120', () => {
    const links = new Map<string, WebLink>()
    const first = Array.from({ length: 80 }, (_, i) => ({ a: `a${i}`, b: `b${i}`, strength: 0.5 }))
    applyLinks(links, first, 0.5, 'DATA', false)
    expect([...links.values()].every((l) => l.alpha === 0)).toBe(true)
    fadeLinks(links, 1)
    expect([...links.values()].every((l) => l.alpha === l.target)).toBe(true)
    const second = Array.from({ length: 80 }, (_, i) => ({ a: `c${i}`, b: `d${i}`, strength: 0.5 }))
    applyLinks(links, second, 0.5, 'DATA', false)
    expect(links.size).toBeLessThanOrEqual(MAX_LINKS)
    fadeLinks(links, 1)
    expect(links.size).toBe(80)
  })

  it('applies links at once in reduced motion', () => {
    const links = new Map<string, WebLink>()
    applyLinks(links, [{ a: 'x', b: 'y', strength: 0.8 }], 1, null, true)
    expect(links.get('x|y')?.alpha).toBe(links.get('x|y')?.target)
  })
})

describe('density and opacity', () => {
  it('keeps the active target within 30 to 80 links and rising with activity', () => {
    expect(activeLinkTarget(0)).toBeGreaterThanOrEqual(30)
    expect(activeLinkTarget(1)).toBeLessThanOrEqual(80)
    expect(activeLinkTarget(1)).toBeGreaterThan(activeLinkTarget(0))
  })

  it('keeps link opacity between 0.25 and 0.7', () => {
    expect(linkAlpha(0, 0)).toBe(MIN_LINK_ALPHA)
    expect(linkAlpha(1, 1)).toBe(MAX_LINK_ALPHA)
  })

  it('scales the threshold with the plot area within bounds', () => {
    expect(scaledThreshold(140, { left: 0, top: 0, width: 1000, height: 650 })).toBeCloseTo(140)
    expect(scaledThreshold(140, { left: 0, top: 0, width: 100, height: 60 })).toBeCloseTo(84)
  })
})
