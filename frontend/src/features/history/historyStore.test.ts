import { describe, expect, it } from 'vitest'
import { isRunResult } from '../../api/result'
import { makeResult } from '../../test/resultFixture'
import { entryFromRequest, HistoryError, HistoryStore, memoryBackend, type Codec, type HistoryBackend } from './historyStore'

const plain: Codec = {
  encode: async (text) => new TextEncoder().encode(text),
  decode: async (data) => new TextDecoder().decode(data),
}

function store(backend: HistoryBackend | null = memoryBackend(), cap?: number) {
  return new HistoryStore(() => backend, plain, cap)
}

const payload = makeResult()
const entry = entryFromRequest('run-1', payload.request, {
  strategyName: 'Opening Range Breakout',
  market: 'us_equity',
  sourceMode: 'SAMPLE DATA',
}, new Date('2026-11-04T10:00:00Z'))

describe('history store', () => {
  it('saves a launch, then the summary and the full result, and reads it back', async () => {
    const history = store()
    await history.put(entry)
    expect((await history.list())[0]).toMatchObject({ id: 'run-1', status: 'running', symbol: 'SAMPLE-A' })
    const saved = await history.saveResult(entry, payload)
    expect(saved).toMatchObject({ status: 'done', verdict: 'NOT_CREDIBLE', netPnl: 125, tradeCount: 5, resultNote: null })
    expect(saved.resultBytes).toBeGreaterThan(0)
    const loaded = await history.loadResult('run-1')
    expect(isRunResult(loaded)).toBe(true)
  })

  it('keeps only the summary when the result is over the size cap', async () => {
    const history = store(memoryBackend(), 1_000)
    const saved = await history.saveResult(entry, payload)
    expect(saved.resultBytes).toBeNull()
    expect(saved.resultNote).toMatch(/over the 0 MB limit|only the summary is kept/)
    expect(await history.loadResult('run-1')).toBeNull()
    expect((await history.get('run-1'))?.verdict).toBe('NOT_CREDIBLE')
  })

  it('reports a full disk as a quota problem with a clear message and keeps the summary', async () => {
    const backend = memoryBackend()
    backend.putResult = async () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    const history = store(backend)
    await expect(history.saveResult(entry, payload)).rejects.toMatchObject({ problem: 'quota' })
    const kept = await history.get('run-1')
    expect(kept?.verdict).toBe('NOT_CREDIBLE')
    expect(kept?.resultNote).toMatch(/no room left/)
  })

  it('never crashes when storage is unavailable', async () => {
    const history = store(null)
    expect(history.available).toBe(false)
    await expect(history.list()).rejects.toBeInstanceOf(HistoryError)
    await expect(history.list()).rejects.toMatchObject({ problem: 'unavailable' })
    const throwing = new HistoryStore(() => {
      throw new Error('blocked')
    }, plain)
    expect(throwing.available).toBe(false)
  })

  it('deletes one run and clears all', async () => {
    const history = store()
    await history.put(entry)
    await history.put({ ...entry, id: 'run-2', savedAt: '2026-11-04T11:00:00Z' })
    expect((await history.list()).map((item) => item.id)).toEqual(['run-2', 'run-1'])
    await history.remove('run-2')
    expect((await history.list()).map((item) => item.id)).toEqual(['run-1'])
    await history.clear()
    expect(await history.list()).toEqual([])
  })

  it('stores the request of a CSV run without any file content', () => {
    const csvEntry = entryFromRequest(
      'csv-1',
      { strategy_id: payload.request.strategy_id, parameters: null, costs: null, risk: null, sizing: null, initial_capital: 10_000, honesty: null, csv: { market: "us_equity", timeframe: "5m" } },
      { strategyName: 'ORB', market: 'us_equity', sourceMode: 'USER CSV' },
    )
    expect(csvEntry.kind).toBe('csv')
    expect(csvEntry.symbol).toBe('CSV file')
    expect(JSON.stringify(csvEntry)).not.toMatch(/timestamp,open|"content"|"file"/i)
  })
})
