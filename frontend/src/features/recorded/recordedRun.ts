import type { RunResultPayload } from '../../api/result'
import { isRunEvent, type RunEvent } from '../../api/runEvents'

export const RECORDED_URL = '/demo/recorded-run.json'
export const RECORDED_LABEL = 'RECORDED RUN · SAMPLE DATA'

export type RecordedRun = {
  schema_version: 1
  recorded_at: string
  note: string
  events: RunEvent[]
  payload: RunResultPayload
}

type Fields = Record<string, unknown>
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)

export function isRecordedRun(value: unknown): value is RecordedRun {
  if (!isObject(value) || value.schema_version !== 1 || !Array.isArray(value.events)) return false
  const payload = value.payload
  if (!isObject(payload) || !isObject(payload.source) || payload.source.mode !== 'SAMPLE DATA') return false
  if (!isObject(payload.bars) || !isObject(payload.heatmap) || !isObject(payload.report) || !isObject(payload.result)) return false
  return value.events.every(isRunEvent) && value.events.at(-1)?.type === 'run_done'
}

export async function loadRecordedRun(fetcher: typeof fetch = fetch, url = RECORDED_URL): Promise<RecordedRun> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`recorded run: HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (!isRecordedRun(body)) throw new Error('recorded run: unreadable file')
  return body
}

export function recordedSummary(run: RecordedRun): string {
  const { payload } = run
  const summary = payload.result.metrics.summary
  return `Recorded run of ${payload.result.strategy} on the synthetic ${payload.source.symbol} set (${payload.source.timeframe}, ${payload.result.bar_count.toLocaleString('en-US')} bars): ${summary.trade_count} trades, honesty verdict ${payload.report.verdict.label}. Sample data, not a market result.`
}

export function canvasSupported(): boolean {
  if (typeof document === 'undefined') return false
  try {
    return Boolean(document.createElement('canvas').getContext('2d'))
  } catch {
    return false
  }
}
