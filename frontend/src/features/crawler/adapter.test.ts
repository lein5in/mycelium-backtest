import { describe, expect, it } from 'vitest'
import sample from '../../../../contracts/run_events.sample.json'
import { isRunEvent, type RunEvent } from '../../api/runEvents'
import { CrawlerEventQueue, LAG_BUDGET_MS, mapEvent, MIN_VISIBLE_MS, type Clock } from './adapter'
import type { CrawlerHandle } from './types'

const events: RunEvent[] = (sample as unknown[]).filter(isRunEvent)
const envelope = { schema_version: 1 as const, run_id: 'r', ts: '2026-01-01T00:00:00Z' }

function recordingHandle(clock: ManualClock) {
  const calls: { name: string; at: number; args: unknown[] }[] = []
  const tempos: number[] = []
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push({ name, at: clock.time, args })
  const handle: CrawlerHandle = {
    start: record('start'),
    setStage: record('setStage'),
    setBeam: record('setBeam'),
    wrap: record('wrap'),
    pulse: record('pulse'),
    finish: record('finish'),
    fail: record('fail'),
    reset: record('reset'),
    moveSpiderTo: record('moveSpiderTo'),
    setAggression: record('setAggression'),
    setTempo: (tempo: number) => tempos.push(tempo),
  }
  return { handle, calls, tempos }
}

class ManualClock implements Clock {
  time = 0
  private timers: { at: number; callback: () => void }[] = []

  now = () => this.time

  schedule = (callback: () => void, delayMs: number) => {
    const timer = { at: this.time + delayMs, callback }
    this.timers.push(timer)
    return () => {
      this.timers = this.timers.filter((candidate) => candidate !== timer)
    }
  }

  advanceTo(time: number) {
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at)
      const next = this.timers[0]
      if (!next || next.at > time) break
      this.timers.shift()
      this.time = next.at
      next.callback()
    }
    this.time = time
  }

  get pendingTimers() {
    return this.timers.length
  }
}

describe('mapEvent (DESIGN 7.1)', () => {
  it('maps every engine event to its handle call', () => {
    expect(mapEvent({ ...envelope, seq: 0, type: 'run_started', bar_count: 400 })).toEqual([
      { method: 'start', args: [400] },
    ])
    expect(mapEvent({ ...envelope, seq: 1, type: 'stage_started', stage: 'DATA' })).toEqual([
      { method: 'setStage', args: ['DATA', 0] },
    ])
    expect(
      mapEvent({ ...envelope, seq: 2, type: 'stage_progress', stage: 'SIMULATOR', progress: 40, detail: null, bar_index: 159 }),
    ).toEqual([
      { method: 'setStage', args: ['SIMULATOR', 40] },
      { method: 'setBeam', args: [159] },
    ])
    expect(mapEvent({ ...envelope, seq: 3, type: 'stage_done', stage: 'DATA', detail: null })).toEqual([
      { method: 'setStage', args: ['DATA', 100] },
    ])
    expect(
      mapEvent({
        ...envelope,
        seq: 4,
        type: 'trade_cluster',
        region: { start_bar: 10, end_bar: 20, price_low: 0.2, price_high: 0.4 },
        fills: 14,
        net_result: 12,
      }),
    ).toEqual([
      {
        method: 'wrap',
        args: [{ startBar: 10, endBar: 20, priceLow: 0.2, priceHigh: 0.4, units: 'fraction', label: 'SIGNAL CLUSTER · 14 FILLS' }],
      },
    ])
    expect(
      mapEvent({ ...envelope, seq: 5, type: 'check_done', check_id: 'versus_random', status: 'WARN', figure: 'x' }),
    ).toEqual([{ method: 'pulse', args: ['check:versus_random', 'WARN'] }])
    expect(mapEvent({ ...envelope, seq: 6, type: 'run_done', verdict: 'FRAGILE' })).toEqual([{ method: 'finish' }])
    expect(mapEvent({ ...envelope, seq: 7, type: 'run_failed', stage: 'SIMULATOR', message: 'm' })).toEqual([
      { method: 'fail', args: ['SIMULATOR'] },
    ])
  })
})

describe('CrawlerEventQueue', () => {
  it('never acts before the event has arrived', () => {
    const clock = new ManualClock()
    const { handle, calls } = recordingHandle(clock)
    const queue = new CrawlerEventQueue(handle, clock)
    clock.advanceTo(5000)
    expect(calls).toEqual([])
    queue.push(events[0] as RunEvent)
    expect(calls.map((c) => c.name)).toEqual(['start'])
    expect(calls[0]?.at).toBe(5000)
  })

  it('holds each event for its minimum visible duration when there is no backlog', () => {
    const clock = new ManualClock()
    const { handle, calls } = recordingHandle(clock)
    const queue = new CrawlerEventQueue(handle, clock)
    queue.push(events[0] as RunEvent)
    clock.advanceTo(100)
    queue.push(events[1] as RunEvent)
    expect(calls).toHaveLength(1)
    clock.advanceTo(MIN_VISIBLE_MS.run_started - 1)
    expect(calls).toHaveLength(1)
    clock.advanceTo(MIN_VISIBLE_MS.run_started + 1)
    expect(calls.map((c) => c.name)).toEqual(['start', 'setStage'])
  })

  it('replays a burst of the whole run in order, drops nothing, and keeps lag within the budget', () => {
    const clock = new ManualClock()
    const { handle, calls } = recordingHandle(clock)
    const queue = new CrawlerEventQueue(handle, clock)
    for (const event of events) queue.push(event)
    clock.advanceTo(60_000)
    expect(queue.pending).toBe(0)
    expect(queue.applied.map((a) => a.seq)).toEqual(events.map((e) => e.seq))
    for (const record of queue.applied) {
      expect(record.appliedAt - record.receivedAt).toBeLessThanOrEqual(LAG_BUDGET_MS + 1e-6)
      expect(record.appliedAt).toBeGreaterThanOrEqual(record.receivedAt)
    }
    expect(calls.filter((c) => c.name === 'wrap')).toHaveLength(3)
    expect(calls.filter((c) => c.name === 'pulse')).toHaveLength(6)
    expect(calls.at(-1)?.name).toBe('finish')
  })

  it('keeps lag bounded for events streamed at engine pace at high speed', () => {
    const clock = new ManualClock()
    const { handle, tempos } = recordingHandle(clock)
    const queue = new CrawlerEventQueue(handle, clock)
    events.forEach((event, index) => {
      clock.advanceTo(index * 40)
      queue.push(event)
    })
    clock.advanceTo(60_000)
    const worst = Math.max(...queue.applied.map((a) => a.appliedAt - a.receivedAt))
    expect(worst).toBeLessThanOrEqual(LAG_BUDGET_MS + 1e-6)
    expect(Math.max(...tempos)).toBeGreaterThan(1)
    expect(tempos.at(-1)).toBe(1)
  })

  it('plays at normal tempo when events arrive slowly', () => {
    const clock = new ManualClock()
    const { handle, tempos } = recordingHandle(clock)
    const queue = new CrawlerEventQueue(handle, clock)
    events.slice(0, 10).forEach((event, index) => {
      clock.advanceTo(index * 3000)
      queue.push(event)
    })
    clock.advanceTo(60_000)
    expect(tempos.every((tempo) => tempo === 1)).toBe(true)
  })

  it('clear stops pending work', () => {
    const clock = new ManualClock()
    const { handle, calls } = recordingHandle(clock)
    const queue = new CrawlerEventQueue(handle, clock)
    queue.push(events[0] as RunEvent)
    queue.push(events[1] as RunEvent)
    queue.clear()
    expect(clock.pendingTimers).toBe(0)
    expect(queue.pending).toBe(0)
    expect(calls).toHaveLength(1)
  })
})
