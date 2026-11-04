import { mulberry32 } from '../../lib/random'
import { MAX_LINKS, MAX_NODES } from './params'
import type { Point } from './types'

export const INTRO_MS = 3500
export const INTRO_NODES = 49
export const SPOKES = 6
export const SPOKE_NODES = 8
export const WORDMARK = 'MYCELIUM'
export const LINK_SHARE = 0.22

export const PHASES = {
  nodesIn: [0, 600],
  linksIn: [400, 1500],
  contract: [1100, 2200],
  wordmark: [2000, 2800],
  subtitle: [2700, 3100],
  relax: [3100, 3500],
} as const

export type IntroNode = { x: number; y: number; alpha: number; radius: number }
export type IntroLink = { a: number; b: number; alpha: number }
export type IntroFrame = {
  nodes: IntroNode[]
  links: IntroLink[]
  letters: number
  tracking: number
  subtitle: number
  overlay: number
  markScale: number
}

export type IntroLayout = { scattered: Point[]; targets: Point[]; scatterLinks: [number, number][]; markLinks: [number, number][] }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const ease = (t: number) => t * t * (3 - 2 * t)
export const progress = (t: number, [start, end]: readonly [number, number]) => clamp01((t - start) / (end - start))

export function introLayout(seed: number, width: number, height: number): IntroLayout {
  const random = mulberry32(seed)
  const centre = { x: width / 2, y: height * 0.42 }
  const radius = Math.min(width, height) * 0.11
  const scattered: Point[] = []
  const targets: Point[] = [centre]
  scattered.push({ x: width * (0.15 + random() * 0.7), y: height * (0.15 + random() * 0.7) })
  for (let spoke = 0; spoke < SPOKES; spoke += 1) {
    const angle = (spoke * Math.PI * 2) / SPOKES - Math.PI / 2
    for (let step = 1; step <= SPOKE_NODES; step += 1) {
      const along = (step / SPOKE_NODES) * radius
      targets.push({ x: centre.x + Math.cos(angle) * along, y: centre.y + Math.sin(angle) * along })
      scattered.push({ x: width * (0.06 + random() * 0.88), y: height * (0.08 + random() * 0.84) })
    }
  }
  const maxDistance = Math.min(width, height) * LINK_SHARE
  const seen = new Set<string>()
  const scatterLinks: [number, number][] = []
  scattered.forEach((point, index) => {
    const nearest = scattered
      .map((other, otherIndex) => ({ otherIndex, distance: Math.hypot(other.x - point.x, other.y - point.y) }))
      .filter((entry) => entry.otherIndex !== index && entry.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
    for (const entry of nearest) {
      const pair: [number, number] = index < entry.otherIndex ? [index, entry.otherIndex] : [entry.otherIndex, index]
      const key = pair.join(':')
      if (seen.has(key)) continue
      seen.add(key)
      scatterLinks.push(pair)
    }
  })
  const markLinks: [number, number][] = []
  for (let spoke = 0; spoke < SPOKES; spoke += 1) {
    const first = 1 + spoke * SPOKE_NODES
    markLinks.push([0, first])
    for (let step = 1; step < SPOKE_NODES; step += 1) markLinks.push([first + step - 1, first + step])
  }
  return { scattered, targets, scatterLinks: scatterLinks.slice(0, MAX_LINKS), markLinks }
}

export function introFrame(layout: IntroLayout, t: number): IntroFrame {
  const appear = ease(progress(t, PHASES.nodesIn))
  const links = ease(progress(t, PHASES.linksIn))
  const contract = ease(progress(t, PHASES.contract))
  const relax = ease(progress(t, PHASES.relax))
  const nodes = layout.scattered.map((start, index) => {
    const target = layout.targets[index] ?? start
    const isSpokeEnd = index > 0 && (index - 1) % SPOKE_NODES === SPOKE_NODES - 1
    return {
      x: start.x + (target.x - start.x) * contract,
      y: start.y + (target.y - start.y) * contract,
      alpha: appear * (1 - relax * 0.85),
      radius: index === 0 ? 2.2 + 1.6 * contract : isSpokeEnd ? 1.6 + 0.8 * contract : 1.4 - 0.5 * contract,
    }
  })
  const scatterAlpha = links * (1 - contract)
  const markAlpha = contract ** 4 * (1 - relax * 0.85)
  const frameLinks: IntroLink[] = [
    ...layout.markLinks.map(([a, b]) => ({ a, b, alpha: markAlpha * 0.75 })),
    ...layout.scatterLinks.map(([a, b]) => ({ a, b, alpha: scatterAlpha * 0.6 })),
  ]
    .filter((link) => link.alpha > 0.01)
    .slice(0, MAX_LINKS)
  const typing = progress(t, PHASES.wordmark)
  return {
    nodes,
    links: frameLinks,
    letters: Math.round(typing * WORDMARK.length),
    tracking: 0.6 - 0.4 * ease(typing),
    subtitle: ease(progress(t, PHASES.subtitle)),
    overlay: 1 - relax,
    markScale: 1 - 0.15 * relax,
  }
}

export function finalFrame(layout: IntroLayout): IntroFrame {
  return { ...introFrame(layout, PHASES.relax[0]), overlay: 1 }
}

export const INTRO_LIMITS_OK = INTRO_NODES <= MAX_NODES
