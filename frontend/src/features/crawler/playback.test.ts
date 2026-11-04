import { describe, expect, it } from 'vitest'
import { STAGES, type RunEvent, type TradeCluster } from '../../api/runEvents'
import type { Clock } from './adapter'
import { clusterFills, membersOf, PlaybackScheduler, TIMINGS, type DisplayItem, type StepInfo } from './playback'

class FakeClock implements Clock {
  time = 0
  private timers: { at: number; callback: () => void; id: number }[] = []
  private next = 0

  now = () => this.time

  schedule = (callback: () => void, delayMs: number) => {
    const id = this.next++
    this.timers.push({ at: this.time + delayMs, callback, id })
    return () => {
      this.timers = this.timers.filter((timer) => timer.id !== id)
    }
  }

  advance(ms: number) {
    const end = this.time + ms
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at)
      const timer = this.timers[0]
      if (!timer || timer.at > end) break
      this.timers.shift()
      this.time = timer.at
      timer.callback()
    }
    this.time = end
  }
}

let seq = 0
const base = { schema_version: 2 as const, run_id: 'r' }
function at(ms: number) {
  return new Date(Date.UTC(2026, 0, 1) + ms).toISOString()
}
function event<T extends RunEvent['type']>(type: T, fields: Record<string, unknown> = {}, ms = seq * 2): RunEvent {
  return { ...base, seq: seq++, ts: at(ms), type, ...fields } as RunEvent
}
const cluster = (start: number, fills: number) =>
  event('trade_cluster', {
    region: { start_bar: start, end_bar: start + 5, price_low: 0.2, price_high: 0.4 },
    fills,
    net_result: 1,
  }) as TradeCluster

function burstRun(clusters: number): RunEvent[] {
  seq = 0
  const events: RunEvent[] = [event('run_started', { bar_count: 4000 })]
  for (const stage of STAGES) {
    events.push(event('stage_started', { stage }))
    if (stage === 'SIMULATOR') {
      for (let index = 0; index < clusters; index += 1) {
        events.push(event('stage_progress', { stage, progress: Math.round((100 * index) / clusters), detail: null, bar_index: index * 10 }))
        events.push(cluster(index * 10, 2 + (index % 3) * 2))
      }
    }
    if (stage === 'AUDITOR') {
      for (const check of ['costs', 'trade_count', 'without_best_trade', 'out_of_sample', 'versus_random', 'robustness']) {
        events.push(event('check_done', { check_id: check, status: 'PASS', figure: 'x' }))
      }
    }
    events.push(event('stage_done', { stage, detail: null }))
  }
  events.push(event('run_done', { verdict: 'FRAGILE' }))
  return events
}

function record() {
  const clock = new FakeClock()
  const steps: { item: DisplayItem; info: StepInfo }[] = []
  const scheduler = new PlaybackScheduler((item, info) => steps.push({ item, info }), clock)
  return { clock, steps, scheduler }
}

describe('playback scheduler', () => {
  it('never shows an event before it arrived', () => {
    const { clock, steps, scheduler } = record()
    const events = burstRun(4)
    const arrivals = new Map<number, number>()
    events.forEach((item, index) => {
      clock.advance(index % 5 === 0 ? 700 : 10)
      arrivals.set(item.seq, clock.time)
      scheduler.push(item)
    })
    clock.advance(60_000)
    expect(steps.flatMap(({ item }) => membersOf(item)).map((item) => item.seq)).toEqual(events.map((item) => item.seq))
    for (const { item, info } of steps) {
      for (const member of membersOf(item)) expect(info.shownAt).toBeGreaterThanOrEqual(arrivals.get(member.seq) ?? Infinity)
    }
  })

  it('does not invent events: nothing is shown without input', () => {
    const { clock, steps } = record()
    clock.advance(30_000)
    expect(steps).toHaveLength(0)
  })

  it('gives each stage and each cluster a minimum visible time', () => {
    const { clock, steps, scheduler } = record()
    for (const item of burstRun(6)) scheduler.push(item)
    clock.advance(60_000)
    for (const { item, info } of steps) {
      const type = item.kind === 'event' ? item.event.type : 'trade_cluster'
      expect(info.plannedHold).toBeGreaterThanOrEqual(TIMINGS[type].floor)
    }
    const stageTimes = new Map<string, number>()
    for (const { item, info } of steps) {
      if (item.kind !== 'event') continue
      const evt = item.event
      if (evt.type === 'stage_started') stageTimes.set(evt.stage, info.shownAt)
      if (evt.type === 'stage_done') expect(info.shownAt - (stageTimes.get(evt.stage) ?? 0)).toBeGreaterThanOrEqual(200)
    }
  })

  it('caps a burst at about fifteen seconds and merges clusters, keeping the true fill counts', () => {
    const { clock, steps, scheduler } = record()
    const events = burstRun(60)
    const totalFills = events.reduce((sum, item) => sum + (item.type === 'trade_cluster' ? item.fills : 0), 0)
    for (const item of events) scheduler.push(item)
    clock.advance(120_000)
    const done = steps.at(-1)
    expect(done?.item.kind === 'event' && done.item.event.type).toBe('run_done')
    expect(done?.info.shownAt ?? Infinity).toBeLessThanOrEqual(16_000)
    const clusterSteps = steps.filter(({ item }) => item.kind === 'clusters' || item.event.type === 'trade_cluster')
    expect(clusterSteps.length).toBeLessThan(60)
    expect(clusterSteps.length).toBeGreaterThanOrEqual(3)
    const shownFills = clusterSteps.reduce(
      (sum, { item }) => sum + (item.kind === 'clusters' ? clusterFills(item) : item.event.type === 'trade_cluster' ? item.event.fills : 0),
      0,
    )
    expect(shownFills).toBe(totalFills)
    for (const { info, item } of clusterSteps) {
      expect(info.plannedHold).toBeGreaterThanOrEqual(TIMINGS.trade_cluster.floor)
      if (item.kind === 'clusters') expect(item.members.length).toBeGreaterThan(1)
    }
  })

  it('plays at full length when there is time and reports the engine time once it is done', () => {
    const { clock, steps, scheduler } = record()
    const events = burstRun(2)
    for (const item of events) scheduler.push(item)
    expect(scheduler.state.engineDone).toBe(true)
    expect(scheduler.state.displayDone).toBe(false)
    expect(scheduler.state.engineSeconds).toBeCloseTo(((events.length - 1) * 2) / 1000)
    clock.advance(60_000)
    expect(steps.every(({ item, info }) => info.plannedHold === TIMINGS[item.kind === 'event' ? item.event.type : 'trade_cluster'].base)).toBe(true)
    expect(scheduler.state.displayDone).toBe(true)
  })

  it('speeds, pauses and steps the display only', () => {
    const { clock, steps, scheduler } = record()
    scheduler.setSpeed(4)
    for (const item of burstRun(1)) scheduler.push(item)
    expect(steps[0]?.info.hold).toBe(TIMINGS.run_started.base / 4)
    scheduler.pause()
    clock.advance(10_000)
    const paused = steps.length
    expect(paused).toBe(1)
    scheduler.step()
    expect(steps.length).toBe(paused + 1)
    clock.advance(10_000)
    expect(steps.length).toBe(paused + 1)
    scheduler.setSpeed('MAX')
    scheduler.resume()
    expect(steps.at(-1)?.item.kind === 'event' && steps.at(-1)?.item).toMatchObject({ event: { type: 'run_done' } })
  })
})

describe('merged cluster display', () => {
  it('wraps the union of the merged regions and labels the true counts', async () => {
    const { mergedRegion } = await import('./playback')
    seq = 0
    const first = cluster(10, 4)
    const second = cluster(40, 6)
    const region = mergedRegion([first, second])
    expect(region).toMatchObject({ startBar: 10, endBar: 45, priceLow: 0.2, priceHigh: 0.4, units: 'fraction' })
    expect(region.label).toBe('2 CLUSTERS · 10 FILLS')
    expect(mergedRegion([first]).label).toBe('SIGNAL CLUSTER · 4 FILLS')
  })
})
