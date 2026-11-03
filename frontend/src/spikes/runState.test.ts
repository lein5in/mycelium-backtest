import { describe, expect, it } from 'vitest'
import sample from '../../../contracts/run_events.sample.json'
import { isRunEvent, STAGES, type RunEvent } from '../api/runEvents'
import { activeStageIndex, initialRunView, overallPercent, reduceRunView } from './runState'

const events: RunEvent[] = (sample as unknown[]).filter(isRunEvent)

describe('run view reducer', () => {
  it('folds the sample run into a finished view', () => {
    const view = events.reduce(reduceRunView, initialRunView())
    expect(view.phase).toBe('done')
    expect(view.verdict).toBe('FRAGILE')
    expect(STAGES.every((stage) => view.stages[stage].state === 'DONE')).toBe(true)
    expect(Object.keys(view.checks)).toHaveLength(6)
    expect(overallPercent(view)).toBe(100)
    expect(activeStageIndex(view)).toBe(6)
  })

  it('ignores duplicate or out-of-order events', () => {
    const first = events[0]
    const second = events[1]
    if (!first || !second) throw new Error('sample too short')
    const view = reduceRunView(reduceRunView(initialRunView(), first), second)
    expect(reduceRunView(view, first)).toBe(view)
  })

  it('marks the failing stage', () => {
    const failed = reduceRunView(initialRunView(), {
      schema_version: 1,
      run_id: 'r',
      seq: 0,
      ts: '2026-01-01T00:00:00Z',
      type: 'run_failed',
      stage: 'SIMULATOR',
      message: 'stopped',
    })
    expect(failed.phase).toBe('failed')
    expect(failed.stages.SIMULATOR.state).toBe('FAIL')
    expect(failed.failure).toEqual({ stage: 'SIMULATOR', message: 'stopped' })
  })
})
