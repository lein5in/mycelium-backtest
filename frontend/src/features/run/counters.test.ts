import { describe, expect, it } from 'vitest'
import type { RunEvent } from '../../api/runEvents'
import { makeResult } from '../../test/resultFixture'
import { deriveCounters } from './counters'

let seq = 0
const event = (type: RunEvent['type'], fields: Record<string, unknown> = {}) =>
  ({ schema_version: 2, run_id: 'r', seq: seq++, ts: '2026-11-04T10:00:00Z', type, ...fields }) as RunEvent

describe('live counters', () => {
  const events: RunEvent[] = [
    event('run_started', { bar_count: 1_000 }),
    event('stage_progress', { stage: 'SIMULATOR', progress: 40, detail: null, bar_index: 399 }),
    event('trade_cluster', { region: { start_bar: 1, end_bar: 9, price_low: 0, price_high: 1 }, fills: 6, net_result: 12 }),
    event('trade_cluster', { region: { start_bar: 20, end_bar: 30, price_low: 0, price_high: 1 }, fills: 4, net_result: -3 }),
    event('check_done', { check_id: 'costs', status: 'PASS', figure: 'x' }),
    event('check_done', { check_id: 'trade_count', status: 'FAIL', figure: 'x' }),
  ]

  it('shows only what the events carried and dashes for the rest until the result arrives', () => {
    const counters = deriveCounters(events, null)
    expect(counters.trades.value).toBe('5')
    expect(counters.clusters.value).toBe('2')
    expect(counters.bars.value).toBe('400 / 1,000')
    expect(counters.checks.value).toBe('2 / 6 · 1 pass · 0 warn · 1 fail')
    expect(counters.equity).toMatchObject({ value: '—', source: 'pending' })
    expect(counters.drawdown).toMatchObject({ value: '—', source: 'pending' })
    expect(counters.winRate).toMatchObject({ value: '—', source: 'pending' })
  })

  it('fills equity, drawdown and win rate from the result', () => {
    const counters = deriveCounters(events, makeResult())
    expect(counters.equity).toMatchObject({ value: '10,125.00 (+125.00)', source: 'result' })
    expect(counters.drawdown).toMatchObject({ value: '−0.41%', source: 'result' })
    expect(counters.winRate).toMatchObject({ value: '60.0%', source: 'result' })
  })

  it('starts empty before any event', () => {
    const counters = deriveCounters([], null)
    expect(counters.trades.value).toBe('0')
    expect(counters.bars.value).toBe('—')
  })
})
