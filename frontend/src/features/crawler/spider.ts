import { LEG_GEOMETRY, legSet, planSwings, snapFoot, type GaitSet, type LegGeometry, type LegId } from './gait'
import { solveTwoBone } from './ik'
import type { Point } from './types'

export type SpiderState = 'idle' | 'crawling' | 'wrapping' | 'releasing' | 'resting' | 'frozen'

export type Leg = {
  geometry: LegGeometry
  foot: Point
  from: Point
  to: Point
  swingStart: number | null
  lift: number
  override: Point | null
}

export type Spider = {
  x: number
  y: number
  vx: number
  vy: number
  heading: number
  state: SpiderState
  target: Point | null
  legs: Leg[]
  lastSet: GaitSet
  fold: number
  foldTarget: number
  airborne: boolean
  cruise: boolean
  breath: number
  history: Point[]
  tempo: number
  aggression: number
  length: number
  reach: number
  stepThreshold: number
  speed: number
}

export type SpiderTuning = { length: number; reach: number; stepThreshold: number; speed: number }

export const BASE_STEP_MS = 170
const HISTORY_LIMIT = 16
const ARRIVAL_DISTANCE = 2.5
export const MAX_SPEED_TEMPO = 2.5

export function createSpider(position: Point, tuning: SpiderTuning, heading = Math.PI / 2): Spider {
  const spider: Spider = {
    x: position.x,
    y: position.y,
    vx: 0,
    vy: 0,
    heading,
    state: 'idle',
    target: null,
    legs: [],
    lastSet: 'B',
    fold: 1,
    foldTarget: 1,
    airborne: false,
    cruise: false,
    breath: 0,
    history: [],
    tempo: 1,
    aggression: 0.5,
    ...tuning,
  }
  spider.legs = LEG_GEOMETRY.map((geometry) => {
    const rest = restPosition(spider, geometry)
    return { geometry, foot: rest, from: rest, to: rest, swingStart: null, lift: 0, override: null }
  })
  for (const leg of spider.legs) leg.foot = foldedFoot(spider, leg.geometry, 1)
  return spider
}

export function applyTuning(spider: Spider, tuning: SpiderTuning): void {
  spider.length = tuning.length
  spider.reach = tuning.reach
  spider.stepThreshold = tuning.stepThreshold
  spider.speed = tuning.speed
}

export function axes(spider: Spider): { forward: Point; right: Point } {
  const forward = { x: Math.cos(spider.heading), y: Math.sin(spider.heading) }
  return { forward, right: { x: -forward.y, y: forward.x } }
}

export function hipPosition(spider: Spider, geometry: LegGeometry): Point {
  const { forward, right } = axes(spider)
  const length = spider.length
  const along = (0.16 + geometry.hipForward * 0.45) * length
  const across = geometry.side * geometry.hipSide * length
  return {
    x: spider.x + forward.x * along + right.x * across,
    y: spider.y + forward.y * along + right.y * across,
  }
}

function legDirection(spider: Spider, geometry: LegGeometry): Point {
  const angle = spider.heading + geometry.side * geometry.restAngle
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

export function restPosition(spider: Spider, geometry: LegGeometry): Point {
  const hip = hipPosition(spider, geometry)
  const direction = legDirection(spider, geometry)
  const distance = geometry.restDistance * spider.reach * spider.length
  return { x: hip.x + direction.x * distance, y: hip.y + direction.y * distance }
}

export function foldedFoot(spider: Spider, geometry: LegGeometry, fold: number): Point {
  const hip = hipPosition(spider, geometry)
  const toward = geometry.pair < 2 ? 0.25 : Math.PI - 0.25
  const tucked = geometry.restAngle + (toward - geometry.restAngle) * 0.45 * fold
  const angle = spider.heading + geometry.side * tucked
  const distance = geometry.restDistance * spider.reach * spider.length * (1 - 0.28 * fold)
  return { x: hip.x + Math.cos(angle) * distance, y: hip.y + Math.sin(angle) * distance }
}

export function legLengths(spider: Spider): { upper: number; lower: number } {
  const total = spider.reach * spider.length
  return { upper: total * 0.5, lower: total * 0.5 }
}

export const KNEE_PROJECTION = 0.4

export function projectedKnee(hip: Point, knee: Point, foot: Point): Point {
  const dx = foot.x - hip.x
  const dy = foot.y - hip.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-9) return knee
  const t = ((knee.x - hip.x) * dx + (knee.y - hip.y) * dy) / lengthSquared
  const base = { x: hip.x + dx * t, y: hip.y + dy * t }
  return { x: base.x + (knee.x - base.x) * KNEE_PROJECTION, y: base.y + (knee.y - base.y) * KNEE_PROJECTION }
}

export function legJoints(spider: Spider, leg: Leg): { hip: Point; knee: Point; foot: Point } {
  const hip = hipPosition(spider, leg.geometry)
  const { upper, lower } = legLengths(spider)
  const solution = solveTwoBone(
    hip,
    leg.foot,
    upper,
    lower,
    { x: spider.x, y: spider.y },
    axes(spider).forward,
    leg.geometry.kneeBias,
  )
  return { hip, knee: projectedKnee(hip, solution.knee, solution.foot), foot: solution.foot }
}

export const MIN_STEP_MS = 70
export const STRIDE_FRACTION = 0.42
export const SETTLE_SPEED = 6
export const SETTLE_THRESHOLD = 0.4

export function stepDuration(spider: Spider): number {
  const base = BASE_STEP_MS / Math.max(0.25, spider.tempo) / (0.8 + 0.4 * spider.aggression)
  const speed = Math.hypot(spider.vx, spider.vy)
  if (speed < 1) return base
  const stride = STRIDE_FRACTION * spider.reach * spider.length
  return Math.min(base, Math.max(MIN_STEP_MS, (stride / speed) * 1000))
}

export function liftedLegs(spider: Spider, now: number): Set<LegId> {
  const lifted = new Set<LegId>()
  for (const leg of spider.legs) {
    if (leg.swingStart !== null && now >= leg.swingStart) lifted.add(leg.geometry.id)
  }
  return lifted
}

function reservedLegs(spider: Spider): Set<LegId> {
  return new Set(spider.legs.filter((leg) => leg.swingStart !== null).map((leg) => leg.geometry.id))
}

const ease = (t: number) => t * t * (3 - 2 * t)

function angleLerp(from: number, to: number, amount: number): number {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * amount
}

export function isArrived(spider: Spider): boolean {
  if (!spider.target) return true
  return (
    Math.hypot(spider.target.x - spider.x, spider.target.y - spider.y) <= ARRIVAL_DISTANCE &&
    Math.hypot(spider.vx, spider.vy) < 20
  )
}

export function moveBody(spider: Spider, dt: number): void {
  if (spider.state === 'frozen') return
  const target = spider.target
  let desiredX = 0
  let desiredY = 0
  if (target) {
    const dx = target.x - spider.x
    const dy = target.y - spider.y
    const distance = Math.hypot(dx, dy)
    if (distance > 0.01) {
      const maxSpeed = spider.speed * Math.min(MAX_SPEED_TEMPO, Math.max(0.25, spider.tempo)) * (0.75 + 0.5 * spider.aggression)
      const speed = spider.cruise ? maxSpeed : Math.min(maxSpeed, distance * 3.2)
      desiredX = (dx / distance) * speed
      desiredY = (dy / distance) * speed
    }
  }
  const response = Math.min(1, dt * 7)
  spider.vx += (desiredX - spider.vx) * response
  spider.vy += (desiredY - spider.vy) * response
  spider.x += spider.vx * dt
  spider.y += spider.vy * dt
  const speed = Math.hypot(spider.vx, spider.vy)
  if (speed > 10) spider.heading = angleLerp(spider.heading, Math.atan2(spider.vy, spider.vx), Math.min(1, dt * 6))
}

export type StepContext = { now: number; dt: number; footholds: readonly Point[]; snapRadius: number }

export function stepLegs(spider: Spider, context: StepContext): void {
  const { now, dt } = context
  const foldRate = Math.min(1, dt * 3)
  spider.fold += (spider.foldTarget - spider.fold) * foldRate
  if (Math.abs(spider.fold - spider.foldTarget) < 0.002) spider.fold = spider.foldTarget
  spider.breath += dt

  if (spider.airborne || spider.fold > 0.04 || spider.state === 'frozen') {
    const pull = spider.state === 'frozen' ? Math.min(1, dt * 2.5) : Math.min(1, dt * 10)
    for (const leg of spider.legs) {
      const goal = foldedFoot(spider, leg.geometry, Math.max(spider.fold, spider.airborne ? 1 : 0))
      if (spider.state === 'frozen' && leg.swingStart !== null) leg.swingStart = null
      leg.lift = spider.state === 'frozen' ? leg.lift * (1 - pull) : 0
      leg.foot = { x: leg.foot.x + (goal.x - leg.foot.x) * pull, y: leg.foot.y + (goal.y - leg.foot.y) * pull }
      leg.from = leg.foot
      leg.to = leg.foot
      if (spider.state !== 'frozen') leg.swingStart = null
    }
    return
  }

  const duration = stepDuration(spider)
  const settling = Math.hypot(spider.vx, spider.vy) < SETTLE_SPEED
  const threshold = spider.stepThreshold * spider.length * (settling ? SETTLE_THRESHOLD : 1)
  const lead = { x: spider.vx * (duration / 1000) * 2, y: spider.vy * (duration / 1000) * 2 }
  const wants = new Set<LegId>()
  for (const leg of spider.legs) {
    if (leg.override) continue
    if (leg.swingStart !== null) continue
    const rest = restPosition(spider, leg.geometry)
    const ahead = { x: rest.x + lead.x * 0.5, y: rest.y + lead.y * 0.5 }
    if (Math.hypot(leg.foot.x - ahead.x, leg.foot.y - ahead.y) > threshold) wants.add(leg.geometry.id)
  }
  const plan = planSwings(wants, reservedLegs(spider), spider.lastSet)
  if (plan.start.length > 0 && plan.set) {
    const anyReserved = spider.legs.some((leg) => leg.swingStart !== null)
    if (!anyReserved) spider.lastSet = plan.set
    for (const id of plan.start) {
      const leg = spider.legs.find((candidate) => candidate.geometry.id === id)
      if (!leg) continue
      const rest = restPosition(spider, leg.geometry)
      const goal = { x: rest.x + lead.x, y: rest.y + lead.y }
      leg.from = leg.foot
      leg.to = snapFoot(goal, context.footholds, context.snapRadius)
      leg.swingStart = now + leg.geometry.phase * duration * 0.35
    }
  }

  for (const leg of spider.legs) {
    if (leg.override) {
      const pull = Math.min(1, dt * 14)
      leg.foot = {
        x: leg.foot.x + (leg.override.x - leg.foot.x) * pull,
        y: leg.foot.y + (leg.override.y - leg.foot.y) * pull,
      }
      leg.lift = Math.min(1, leg.lift + dt * 6) * 0.7
      leg.swingStart = null
      continue
    }
    if (leg.swingStart === null) {
      leg.lift = Math.max(0, leg.lift - dt * 6)
      continue
    }
    const t = (now - leg.swingStart) / duration
    if (t < 0) continue
    if (t >= 1) {
      leg.foot = leg.to
      leg.lift = 0
      leg.swingStart = null
      spider.history.push(leg.to)
      if (spider.history.length > HISTORY_LIMIT) spider.history.shift()
      continue
    }
    const k = ease(t)
    leg.foot = { x: leg.from.x + (leg.to.x - leg.from.x) * k, y: leg.from.y + (leg.to.y - leg.from.y) * k }
    leg.lift = Math.sin(Math.PI * t)
  }
  keepFeetInReach(spider)
}

export function keepFeetInReach(spider: Spider): void {
  const { upper, lower } = legLengths(spider)
  const reach = upper + lower
  for (const leg of spider.legs) {
    if (leg.swingStart !== null && leg.lift > 0) continue
    const hip = hipPosition(spider, leg.geometry)
    const dx = leg.foot.x - hip.x
    const dy = leg.foot.y - hip.y
    const distance = Math.hypot(dx, dy)
    if (distance <= reach) continue
    leg.foot = { x: hip.x + (dx / distance) * reach, y: hip.y + (dy / distance) * reach }
  }
}

export function setsInAir(spider: Spider, now: number): Set<GaitSet> {
  return new Set([...liftedLegs(spider, now)].map(legSet))
}

export function sway(spider: Spider): Point {
  const { right } = axes(spider)
  const moving = Math.min(1, Math.hypot(spider.vx, spider.vy) / 120)
  const swing = spider.lastSet === 'A' ? 1 : -1
  const amount = moving * 0.9 * swing + Math.sin(spider.breath * 1.6) * 0.25
  return { x: right.x * amount, y: right.y * amount }
}
