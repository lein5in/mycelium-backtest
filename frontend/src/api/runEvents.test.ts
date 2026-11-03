import { describe, expect, it } from 'vitest'
import sample from '../../../contracts/run_events.sample.json'
import { CHECK_IDS, isRunEvent, parseRunEvent, STAGES } from './runEvents'

describe('run event contract', () => {
  it('accepts every event of the committed sample sequence', () => {
    expect(sample.length).toBeGreaterThan(0)
    for (const event of sample) expect(isRunEvent(event)).toBe(true)
  })

  it('reads the sample as a complete successful run', () => {
    const events = sample.filter(isRunEvent)
    expect(events.length).toBe(sample.length)
    expect(events[0]?.type).toBe('run_started')
    expect(events.at(-1)?.type).toBe('run_done')
    const started = events.flatMap((e) => (e.type === 'stage_started' ? [e.stage] : []))
    expect(started).toEqual([...STAGES])
    const checks = events.flatMap((e) => (e.type === 'check_done' ? [e.check_id] : []))
    expect(checks).toEqual([...CHECK_IDS])
    expect(events.map((e) => e.seq)).toEqual(events.map((_, index) => index))
  })

  it('rejects malformed events', () => {
    const base = sample[0]
    expect(isRunEvent({ ...base, schema_version: 2 })).toBe(false)
    expect(isRunEvent({ ...base, type: 'teleport' })).toBe(false)
    expect(isRunEvent({ ...base, seq: -1 })).toBe(false)
    expect(isRunEvent({ ...base, ts: 'not a date' })).toBe(false)
    expect(isRunEvent({ ...base, bar_count: 0 })).toBe(false)
    expect(isRunEvent(null)).toBe(false)
    const cluster = sample.find((e) => e.type === 'trade_cluster')
    expect(cluster).toBeDefined()
    expect(
      isRunEvent({ ...cluster, region: { start_bar: 9, end_bar: 3, price_low: 0, price_high: 1 } }),
    ).toBe(false)
  })

  it('parses SSE data strings defensively', () => {
    expect(parseRunEvent(JSON.stringify(sample[0]))?.type).toBe('run_started')
    expect(parseRunEvent('{oops')).toBeNull()
    expect(parseRunEvent('{"type":"run_done"}')).toBeNull()
  })
})
