import type { Point } from './types'

export const LEG_IDS = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'] as const
export type LegId = (typeof LEG_IDS)[number]
export type GaitSet = 'A' | 'B'

export const SET_A: readonly LegId[] = ['L1', 'R2', 'L3', 'R4']
export const SET_B: readonly LegId[] = ['R1', 'L2', 'R3', 'L4']

export const legSet = (id: LegId): GaitSet => (SET_A.includes(id) ? 'A' : 'B')

export type LegGeometry = {
  id: LegId
  side: -1 | 1
  pair: number
  hipForward: number
  hipSide: number
  restAngle: number
  restDistance: number
  kneeBias: number
  phase: number
}

const restAngles = [34, 72, 112, 150]
const restDistances = [0.78, 0.7, 0.7, 0.78]
const kneeBiases = [0.15, 0.45, -0.45, 0.15]
const hipForwards = [0.34, 0.2, 0.06, -0.08]
const phases = [0, 0.32, 0.58, 0.18]

export const LEG_GEOMETRY: readonly LegGeometry[] = LEG_IDS.map((id) => {
  const side = id.startsWith('L') ? -1 : 1
  const pair = Number(id.slice(1)) - 1
  return {
    id,
    side,
    pair,
    hipForward: hipForwards[pair] ?? 0,
    hipSide: 0.12,
    restAngle: ((restAngles[pair] ?? 90) * Math.PI) / 180,
    restDistance: restDistances[pair] ?? 0.9,
    kneeBias: kneeBiases[pair] ?? 0.15,
    phase: (phases[pair] ?? 0) + (side === 1 ? 0.07 : 0),
  }
})

export type SwingPlan = { set: GaitSet | null; start: LegId[] }

export function planSwings(
  wants: ReadonlySet<LegId>,
  lifted: ReadonlySet<LegId>,
  lastSet: GaitSet,
): SwingPlan {
  if (lifted.size > 0) return { set: null, start: [] }
  const wantA = SET_A.filter((id) => wants.has(id))
  const wantB = SET_B.filter((id) => wants.has(id))
  if (wantA.length === 0 && wantB.length === 0) return { set: null, start: [] }
  const preferred: GaitSet = lastSet === 'A' ? 'B' : 'A'
  const chosen: GaitSet =
    wantA.length === wantB.length ? preferred : wantA.length > wantB.length ? 'A' : 'B'
  return { set: chosen, start: chosen === 'A' ? wantA : wantB }
}

export function snapFoot(target: Point, nodes: readonly Point[], radius: number): Point {
  let best: Point | null = null
  let bestDistance = radius
  for (const node of nodes) {
    const distance = Math.hypot(node.x - target.x, node.y - target.y)
    if (distance <= bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  return best ? { x: best.x, y: best.y } : { x: target.x, y: target.y }
}
