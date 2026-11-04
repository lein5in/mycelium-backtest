import type { RunEvent, TradeCluster } from '../../api/runEvents'
import { applyCall, mapEvent, realClock, type Clock } from './adapter'
import type { CrawlerHandle, WrapRegion } from './types'

export type DisplayItem =
  | { kind: 'event'; event: RunEvent; receivedAt: number }
  | { kind: 'clusters'; members: TradeCluster[]; receivedAt: number }

export type Timing = { base: number; floor: number }

export const TIMINGS: Record<RunEvent['type'], Timing> = {
  run_started: { base: 1100, floor: 600 },
  stage_started: { base: 300, floor: 200 },
  stage_progress: { base: 140, floor: 0 },
  stage_done: { base: 300, floor: 200 },
  trade_cluster: { base: 2400, floor: 1100 },
  check_done: { base: 650, floor: 300 },
  run_done: { base: 0, floor: 0 },
  run_failed: { base: 0, floor: 0 },
}

export const PLAYBACK_CAP_MS = 15_000
export const MAX_TEMPO = 4

export type DisplaySpeed = 1 | 4 | 16 | 'MAX'
export const DISPLAY_SPEEDS: DisplaySpeed[] = [1, 4, 16, 'MAX']

export type StepInfo = { hold: number; plannedHold: number; tempo: number; shownAt: number }

export type PlaybackState = {
  paused: boolean
  speed: DisplaySpeed
  pending: number
  shown: number
  engineDone: boolean
  displayDone: boolean
  engineSeconds: number | null
}

const typeOf = (item: DisplayItem): RunEvent['type'] => (item.kind === 'event' ? item.event.type : 'trade_cluster')

const timingOf = (item: DisplayItem): Timing => TIMINGS[typeOf(item)]

const isTerminal = (event: RunEvent) => event.type === 'run_done' || event.type === 'run_failed'

export function membersOf(item: DisplayItem): RunEvent[] {
  return item.kind === 'event' ? [item.event] : item.members
}

export function clusterFills(item: DisplayItem): number {
  return item.kind === 'clusters' ? item.members.reduce((sum, member) => sum + member.fills, 0) : 0
}

function mergeGroup(group: DisplayItem[]): DisplayItem {
  const members = group.flatMap((item) => (item.kind === 'clusters' ? item.members : item.kind === 'event' && item.event.type === 'trade_cluster' ? [item.event] : []))
  return { kind: 'clusters', members, receivedAt: Math.max(...group.map((item) => item.receivedAt)) }
}

export function mergeClusters(queue: DisplayItem[], allowed: number): DisplayItem[] {
  const positions = queue.flatMap((item, index) => (typeOf(item) === 'trade_cluster' ? [index] : []))
  if (positions.length <= allowed) return queue
  const groups = Math.max(1, allowed)
  const size = positions.length / groups
  const lastOfGroup = new Map<number, DisplayItem[]>()
  const absorbed = new Set<number>()
  for (let group = 0; group < groups; group += 1) {
    const members = positions.slice(Math.round(group * size), Math.round((group + 1) * size))
    if (members.length === 0) continue
    const last = members[members.length - 1] ?? 0
    lastOfGroup.set(last, members.map((position) => queue[position] as DisplayItem))
    for (const position of members) if (position !== last) absorbed.add(position)
  }
  return queue.flatMap((item, index) => {
    if (absorbed.has(index)) return []
    const group = lastOfGroup.get(index)
    if (!group) return [item]
    return [group.length === 1 ? item : mergeGroup(group)]
  })
}

export function compression(queue: readonly DisplayItem[], remaining: number): number {
  const timings = queue.map(timingOf)
  const total = (k: number) => timings.reduce((sum, timing) => sum + Math.max(timing.floor, k * timing.base), 0)
  if (total(1) <= remaining) return 1
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (low + high) / 2
    if (total(middle) <= remaining) low = middle
    else high = middle
  }
  return low
}

export function allowedClusters(queue: readonly DisplayItem[], remaining: number): number {
  const others = queue.reduce((sum, item) => (typeOf(item) === 'trade_cluster' ? sum : sum + timingOf(item).floor), 0)
  return Math.max(1, Math.floor((remaining - others) / TIMINGS.trade_cluster.floor))
}

export class PlaybackScheduler {
  private queue: DisplayItem[] = []
  private cancelTimer: (() => void) | null = null
  private busy = false
  private used = 0
  private dueAt: number | null = null
  private shown = 0
  private paused = false
  private speed: DisplaySpeed = 1
  private engineDone = false
  private displayDone = false
  private firstTs: number | null = null
  private lastTs: number | null = null
  private listeners = new Set<() => void>()

  constructor(
    private readonly onStep: (item: DisplayItem, info: StepInfo) => void,
    private readonly clock: Clock = realClock,
    private readonly cap = PLAYBACK_CAP_MS,
  ) {}

  push(event: RunEvent): void {
    const ts = Date.parse(event.ts)
    if (this.firstTs === null) this.firstTs = ts
    this.lastTs = ts
    if (isTerminal(event)) this.engineDone = true
    this.queue.push({ kind: 'event', event, receivedAt: this.clock.now() })
    this.notify()
    if (!this.busy && !this.paused) this.drain()
  }

  setSpeed(speed: DisplaySpeed): void {
    this.speed = speed
    this.notify()
    if (speed === 'MAX' && this.busy && !this.paused) {
      this.cancelTimer?.()
      this.cancelTimer = null
      this.drain()
    }
  }

  pause(): void {
    this.paused = true
    this.notify()
  }

  resume(): void {
    this.paused = false
    this.notify()
    if (!this.busy) this.drain()
  }

  step(): void {
    if (!this.paused) return
    this.cancelTimer?.()
    this.cancelTimer = null
    this.busy = false
    this.drain(true)
  }

  dispose(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    this.queue = []
    this.busy = false
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get state(): PlaybackState {
    const engineSeconds =
      this.engineDone && this.firstTs !== null && this.lastTs !== null ? (this.lastTs - this.firstTs) / 1000 : null
    return {
      paused: this.paused,
      speed: this.speed,
      pending: this.queue.length,
      shown: this.shown,
      engineDone: this.engineDone,
      displayDone: this.displayDone,
      engineSeconds,
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private plan(): { item: DisplayItem; planned: number; base: number } | null {
    if (this.queue.length === 0) return null
    const remaining = Math.max(0, this.cap - this.used)
    const floors = this.queue.reduce((sum, item) => sum + timingOf(item).floor, 0)
    if (floors > remaining) this.queue = mergeClusters(this.queue, allowedClusters(this.queue, remaining))
    const k = compression(this.queue, remaining)
    const item = this.queue.shift()
    if (!item) return null
    const timing = timingOf(item)
    return { item, planned: Math.max(timing.floor, k * timing.base), base: timing.base }
  }

  private drain(single = false): void {
    if (this.paused && !single) {
      this.busy = false
      this.dueAt = null
      return
    }
    const next = this.plan()
    if (!next) {
      this.busy = false
      this.dueAt = null
      this.notify()
      return
    }
    this.busy = true
    const divisor = this.speed === 'MAX' ? Infinity : this.speed
    const hold = next.planned / divisor
    const tempo = Math.min(MAX_TEMPO, Math.max(1, next.base / Math.max(1, hold)))
    this.used += next.planned
    this.shown += 1
    if (next.item.kind === 'event' && isTerminal(next.item.event)) this.displayDone = true
    this.onStep(next.item, { hold, plannedHold: next.planned, tempo, shownAt: this.clock.now() })
    this.notify()
    if (single) {
      this.busy = false
      this.dueAt = null
      return
    }
    const now = this.clock.now()
    this.dueAt = (this.dueAt ?? now) + hold
    const delay = Math.max(0, this.dueAt - now)
    if (delay <= 0) {
      this.drain()
      return
    }
    this.cancelTimer = this.clock.schedule(() => {
      this.cancelTimer = null
      this.drain()
    }, delay)
  }
}

export function mergedLabel(members: readonly TradeCluster[]): string {
  const fills = members.reduce((sum, member) => sum + member.fills, 0)
  return members.length === 1 ? `SIGNAL CLUSTER · ${fills} FILLS` : `${members.length} CLUSTERS · ${fills} FILLS`
}

export function mergedRegion(members: readonly TradeCluster[]): WrapRegion {
  return {
    startBar: Math.min(...members.map((member) => member.region.start_bar)),
    endBar: Math.max(...members.map((member) => member.region.end_bar)),
    priceLow: Math.min(...members.map((member) => member.region.price_low)),
    priceHigh: Math.max(...members.map((member) => member.region.price_high)),
    units: 'fraction',
    label: mergedLabel(members),
  }
}

export function applyDisplayItem(handle: CrawlerHandle, item: DisplayItem, info: StepInfo): void {
  handle.setTempo(info.tempo)
  if (item.kind === 'clusters') {
    handle.wrap(mergedRegion(item.members))
    return
  }
  for (const call of mapEvent(item.event)) applyCall(handle, call)
}
