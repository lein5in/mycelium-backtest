import type { Stage } from '../../api/runEvents'
import { mulberry32 } from '../../lib/random'
import {
  MAX_ACTIVE_LINKS,
  MAX_LINK_ALPHA,
  MAX_LINKS,
  MIN_ACTIVE_LINKS,
  MIN_LINK_ALPHA,
  REFERENCE_PLOT_AREA,
} from './params'
import type { DataPoint, Point, Pulse, Rect } from './types'

export type NodeKind = 'ambient' | 'anchor' | 'check' | 'cluster'

export type WebNode = {
  id: string
  kind: NodeKind
  u: number
  v: number
  du: number
  dv: number
  x: number
  y: number
  radius: number
  visibility: number
  onScreen: boolean
  data: DataPoint | null
  pulse: Pulse | null
}

export type WebLink = {
  key: string
  a: string
  b: string
  strength: number
  alpha: number
  target: number
  stage: Stage | null
}

export type LinkChoice = { a: string; b: string; strength: number }

export function makeNode(id: string, kind: NodeKind, radius: number): WebNode {
  return {
    id,
    kind,
    u: 0,
    v: 0,
    du: 0,
    dv: 0,
    x: 0,
    y: 0,
    radius,
    visibility: 0,
    onScreen: false,
    data: null,
    pulse: null,
  }
}

export function seedAmbient(seed: number, count: number, aspect = 1.6): WebNode[] {
  const random = mulberry32(seed)
  const columns = Math.max(1, Math.round(Math.sqrt(count * aspect)))
  const rows = Math.max(1, Math.ceil(count / columns))
  const cells = Array.from({ length: columns * rows }, (_, index) => index)
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const held = cells[index] ?? 0
    cells[index] = cells[swap] ?? 0
    cells[swap] = held
  }
  return cells.slice(0, count).map((cell, index) => {
    const node = makeNode(`ambient:${index}`, 'ambient', 1.3 + random() * 1.2)
    const column = cell % columns
    const row = Math.floor(cell / columns)
    node.u = (column + 0.5 + (random() - 0.5) * 0.7) / columns
    node.v = (row + 0.5 + (random() - 0.5) * 0.7) / rows
    const angle = random() * Math.PI * 2
    const speed = 0.5 + random() * 0.5
    node.du = Math.cos(angle) * speed
    node.dv = Math.sin(angle) * speed
    return node
  })
}

export function driftAmbient(node: WebNode, plot: Rect, driftSpeed: number, dt: number): void {
  if (node.kind !== 'ambient' || plot.width <= 0 || plot.height <= 0) return
  node.u += (node.du * driftSpeed * dt) / plot.width
  node.v += (node.dv * driftSpeed * dt) / plot.height
  const margin = 0.02
  if (node.u < margin || node.u > 1 - margin) {
    node.du = -node.du
    node.u = Math.min(1 - margin, Math.max(margin, node.u))
  }
  if (node.v < margin || node.v > 1 - margin) {
    node.dv = -node.dv
    node.v = Math.min(1 - margin, Math.max(margin, node.v))
  }
}

export function scaledThreshold(linkDistance: number, plot: Rect): number {
  const scale = Math.sqrt((plot.width * plot.height) / REFERENCE_PLOT_AREA)
  return linkDistance * Math.min(1.4, Math.max(0.6, scale))
}

export function activeLinkTarget(activity: number): number {
  const level = Math.min(1, Math.max(0, activity))
  return Math.round(MIN_ACTIVE_LINKS + (MAX_ACTIVE_LINKS - MIN_ACTIVE_LINKS) * level)
}

export function linkAlpha(strength: number, activity: number): number {
  const value =
    MIN_LINK_ALPHA + (MAX_LINK_ALPHA - MIN_LINK_ALPHA) * strength * (0.45 + 0.55 * activity)
  return Math.min(MAX_LINK_ALPHA, Math.max(MIN_LINK_ALPHA, value))
}

type Positioned = { id: string; x: number; y: number }

export function chooseLinks(
  nodes: readonly Positioned[],
  threshold: number,
  options: { targetCount: number; maxDegree: number; attractor: Point | null; random: () => number },
): LinkChoice[] {
  const cell = Math.max(1, threshold)
  const grid = new Map<string, number[]>()
  nodes.forEach((node, index) => {
    const key = `${Math.floor(node.x / cell)}:${Math.floor(node.y / cell)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(index)
    else grid.set(key, [index])
  })
  const scored: { a: number; b: number; strength: number; score: number }[] = []
  nodes.forEach((node, index) => {
    const cx = Math.floor(node.x / cell)
    const cy = Math.floor(node.y / cell)
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
        for (const other of grid.get(`${gx}:${gy}`) ?? []) {
          if (other <= index) continue
          const peer = nodes[other]
          if (!peer) continue
          const distance = Math.hypot(peer.x - node.x, peer.y - node.y)
          if (distance <= 0 || distance > threshold) continue
          const strength = 1 - distance / threshold
          let score = strength + options.random() * 0.15
          if (options.attractor) {
            const midX = (peer.x + node.x) / 2 - options.attractor.x
            const midY = (peer.y + node.y) / 2 - options.attractor.y
            score += 0.6 * Math.max(0, 1 - Math.hypot(midX, midY) / (threshold * 2.2))
          }
          scored.push({ a: index, b: other, strength, score })
        }
      }
    }
  })
  scored.sort((x, y) => y.score - x.score)
  const limit = Math.min(options.targetCount, MAX_ACTIVE_LINKS)
  const degree = new Map<number, number>()
  const taken = new Set<string>()
  const chosen: LinkChoice[] = []
  const take = (pair: { a: number; b: number; strength: number }) => {
    if (chosen.length >= limit) return
    const key = `${pair.a}:${pair.b}`
    if (taken.has(key)) return
    const da = degree.get(pair.a) ?? 0
    const db = degree.get(pair.b) ?? 0
    if (da >= options.maxDegree || db >= options.maxDegree) return
    const a = nodes[pair.a]
    const b = nodes[pair.b]
    if (!a || !b) return
    taken.add(key)
    degree.set(pair.a, da + 1)
    degree.set(pair.b, db + 1)
    chosen.push({ a: a.id, b: b.id, strength: pair.strength })
  }
  const nearest = new Map<number, { a: number; b: number; strength: number }>()
  for (const pair of scored) {
    for (const end of [pair.a, pair.b]) {
      const best = nearest.get(end)
      if (!best || pair.strength > best.strength) nearest.set(end, pair)
    }
  }
  for (const pair of nearest.values()) take(pair)
  for (const pair of scored) take(pair)
  return chosen
}

export const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function applyLinks(
  links: Map<string, WebLink>,
  chosen: readonly LinkChoice[],
  activity: number,
  stage: Stage | null,
  immediate: boolean,
): void {
  const keep = new Set<string>()
  for (const choice of chosen) {
    const key = linkKey(choice.a, choice.b)
    keep.add(key)
    const target = linkAlpha(choice.strength, activity)
    const existing = links.get(key)
    if (existing) {
      existing.target = target
      existing.strength = choice.strength
      if (immediate) existing.alpha = target
    } else {
      links.set(key, {
        key,
        a: choice.a,
        b: choice.b,
        strength: choice.strength,
        alpha: immediate ? target : 0,
        target,
        stage,
      })
    }
  }
  for (const [key, link] of links) {
    if (keep.has(key)) continue
    link.target = 0
    if (immediate) links.delete(key)
  }
  if (links.size <= MAX_LINKS) return
  const fading = [...links.values()]
    .filter((link) => link.target === 0)
    .sort((x, y) => x.alpha - y.alpha)
  for (const link of fading) {
    if (links.size <= MAX_LINKS) break
    links.delete(link.key)
  }
}

export function fadeLinks(links: Map<string, WebLink>, dt: number, fadeSeconds = 0.35): void {
  const step = dt / fadeSeconds
  for (const [key, link] of links) {
    link.alpha =
      link.alpha < link.target
        ? Math.min(link.target, link.alpha + step)
        : Math.max(link.target, link.alpha - step)
    if (link.target === 0 && link.alpha <= 0.001) links.delete(key)
  }
}
