import type { Point } from './types'

export type TwoBoneSolution = { knee: Point; foot: Point; reached: boolean }

export function solveTwoBone(
  hip: Point,
  target: Point,
  upper: number,
  lower: number,
  outwardFrom: Point,
  forward: Point,
  forwardBias = 0.15,
): TwoBoneSolution {
  const dx = target.x - hip.x
  const dy = target.y - hip.y
  const rawDistance = Math.hypot(dx, dy)
  const maxReach = upper + lower
  const minReach = Math.abs(upper - lower) + 1e-6
  const distance = Math.min(maxReach, Math.max(minReach, rawDistance))
  const ux = rawDistance > 1e-9 ? dx / rawDistance : 1
  const uy = rawDistance > 1e-9 ? dy / rawDistance : 0
  const foot = { x: hip.x + ux * distance, y: hip.y + uy * distance }
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
  const height = Math.sqrt(Math.max(0, upper * upper - along * along))
  const baseX = hip.x + ux * along
  const baseY = hip.y + uy * along
  const first = { x: baseX - uy * height, y: baseY + ux * height }
  const second = { x: baseX + uy * height, y: baseY - ux * height }
  const right = { x: -forward.y, y: forward.x }
  const score = (knee: Point) =>
    Math.abs((knee.x - outwardFrom.x) * right.x + (knee.y - outwardFrom.y) * right.y) +
    forwardBias * ((knee.x - hip.x) * forward.x + (knee.y - hip.y) * forward.y)
  const knee = score(first) >= score(second) ? first : second
  return { knee, foot, reached: rawDistance <= maxReach + 1e-6 }
}
