import type { RunEvent } from '../../api/runEvents'
import { checkNodeId } from './model'
import type { CrawlerHandle } from './types'

export type HandleCall =
  | { method: 'start'; args: Parameters<CrawlerHandle['start']> }
  | { method: 'setStage'; args: Parameters<CrawlerHandle['setStage']> }
  | { method: 'setBeam'; args: Parameters<CrawlerHandle['setBeam']> }
  | { method: 'wrap'; args: Parameters<CrawlerHandle['wrap']> }
  | { method: 'pulse'; args: Parameters<CrawlerHandle['pulse']> }
  | { method: 'finish' }
  | { method: 'fail'; args: Parameters<CrawlerHandle['fail']> }

export function clusterLabel(fills: number): string {
  return `SIGNAL CLUSTER · ${fills} FILLS`
}

export function mapEvent(event: RunEvent): HandleCall[] {
  switch (event.type) {
    case 'run_started':
      return [{ method: 'start', args: [event.bar_count] }]
    case 'stage_started':
      return [{ method: 'setStage', args: [event.stage, 0] }]
    case 'stage_progress': {
      const calls: HandleCall[] = [{ method: 'setStage', args: [event.stage, event.progress] }]
      if (event.bar_index !== null) calls.push({ method: 'setBeam', args: [event.bar_index] })
      return calls
    }
    case 'stage_done':
      return [{ method: 'setStage', args: [event.stage, 100] }]
    case 'trade_cluster':
      return [
        {
          method: 'wrap',
          args: [
            {
              startBar: event.region.start_bar,
              endBar: event.region.end_bar,
              priceLow: event.region.price_low,
              priceHigh: event.region.price_high,
              units: 'fraction',
              label: clusterLabel(event.fills),
            },
          ],
        },
      ]
    case 'check_done':
      return [{ method: 'pulse', args: [checkNodeId(event.check_id), event.status] }]
    case 'run_done':
      return [{ method: 'finish' }]
    case 'run_failed':
      return [{ method: 'fail', args: [event.stage] }]
  }
}

export function applyCall(handle: CrawlerHandle, call: HandleCall): void {
  switch (call.method) {
    case 'start':
      handle.start(...call.args)
      return
    case 'setStage':
      handle.setStage(...call.args)
      return
    case 'setBeam':
      handle.setBeam(...call.args)
      return
    case 'wrap':
      handle.wrap(...call.args)
      return
    case 'pulse':
      handle.pulse(...call.args)
      return
    case 'finish':
      handle.finish()
      return
    case 'fail':
      handle.fail(...call.args)
      return
  }
}

export const LAG_BUDGET_MS = 2500
export const MIN_TEMPO_COMPRESSION = 0.25

export const MIN_VISIBLE_MS: Record<RunEvent['type'], number> = {
  run_started: 1100,
  stage_started: 260,
  stage_progress: 150,
  stage_done: 120,
  trade_cluster: 2700,
  check_done: 650,
  run_done: 0,
  run_failed: 0,
}

export type Clock = {
  now: () => number
  schedule: (callback: () => void, delayMs: number) => () => void
}

export const realClock: Clock = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => {
    const id = setTimeout(callback, delayMs)
    return () => clearTimeout(id)
  },
}

type Queued = { event: RunEvent; receivedAt: number }

export type AppliedRecord = { seq: number; receivedAt: number; appliedAt: number; hold: number; tempo: number }

export class CrawlerEventQueue {
  private readonly queue: Queued[] = []
  private cancelTimer: (() => void) | null = null
  private busy = false
  readonly applied: AppliedRecord[] = []

  constructor(
    private readonly handle: CrawlerHandle,
    private readonly clock: Clock = realClock,
    private readonly minVisible: Record<RunEvent['type'], number> = MIN_VISIBLE_MS,
    private readonly lagBudget = LAG_BUDGET_MS,
  ) {}

  push(event: RunEvent): void {
    this.queue.push({ event, receivedAt: this.clock.now() })
    if (!this.busy) this.drain()
  }

  get pending(): number {
    return this.queue.length
  }

  clear(): void {
    this.queue.length = 0
    this.cancelTimer?.()
    this.cancelTimer = null
    this.busy = false
  }

  private drain(): void {
    const item = this.queue.shift()
    if (!item) {
      this.busy = false
      this.handle.setTempo(1)
      return
    }
    this.busy = true
    const now = this.clock.now()
    const lag = now - item.receivedAt
    const own = this.minVisible[item.event.type]
    const backlog = this.queue.reduce((sum, queued) => sum + this.minVisible[queued.event.type], own)
    const budget = Math.max(0, this.lagBudget - lag)
    const compression = backlog > 0 ? Math.min(1, budget / backlog) : 1
    const tempo = 1 / Math.max(MIN_TEMPO_COMPRESSION, compression)
    this.handle.setTempo(tempo)
    for (const call of mapEvent(item.event)) applyCall(this.handle, call)
    const hold = own * compression
    this.applied.push({ seq: item.event.seq, receivedAt: item.receivedAt, appliedAt: now, hold, tempo })
    if (this.applied.length > 500) this.applied.shift()
    if (hold <= 0) {
      this.drain()
      return
    }
    this.cancelTimer = this.clock.schedule(() => {
      this.cancelTimer = null
      this.drain()
    }, hold)
  }
}
