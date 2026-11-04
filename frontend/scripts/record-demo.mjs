import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = process.env.RECORD_API_URL ?? 'http://127.0.0.1:8417'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/demo/recorded-run.json')
const LIMIT_BYTES = 1_600_000

const REQUEST = {
  strategy_id: 'rsi_mean_reversion',
  data: { provider: 'samples', symbol: 'SAMPLE-A', timeframe: '5m', start: '2024-01-02T00:00:00Z', end: '2024-04-01T00:00:00Z' },
  honesty: { random_draws: 1000, seed: 1, sweep: true },
}

const round = (value, digits) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value)

async function readEvents(url) {
  const response = await fetch(url, { headers: { Accept: 'text/event-stream' } })
  if (!response.ok || !response.body) throw new Error(`events: HTTP ${response.status}`)
  const decoder = new TextDecoder()
  const events = []
  let buffer = ''
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block.split('\n').find((line) => line.startsWith('data: '))
      if (!data) continue
      const event = JSON.parse(data.slice(6))
      events.push(event)
      if (event.type === 'run_done' || event.type === 'run_failed') return events
    }
  }
  return events
}

const created = await fetch(`${API}/api/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(REQUEST),
})
if (!created.ok) throw new Error(`run refused: HTTP ${created.status} ${await created.text()}`)
const run = await created.json()
const events = await readEvents(`${API}${run.events_url}`)
if (events.at(-1)?.type !== 'run_done') throw new Error(`run did not finish: ${JSON.stringify(events.at(-1))}`)
const result = await (await fetch(`${API}${run.result_url}`)).json()

if (result.source.provider !== 'samples' || result.source.mode !== 'SAMPLE DATA') {
  throw new Error(`refusing to record non-sample data: ${result.source.provider} ${result.source.mode}`)
}

const recorded = {
  schema_version: 1,
  recorded_at: new Date().toISOString(),
  note: 'Recorded run of Mycelium Backtest on the synthetic SAMPLE-A set (fixed seed). Not real market data.',
  events: events.map((event) => ({ ...event, run_id: 'recorded' })),
  payload: {
    ...result,
    run_id: 'recorded',
    csv_report: null,
    bars: {
      time: result.bars.time,
      open: result.bars.open.map((value) => round(value, 4)),
      high: result.bars.high.map((value) => round(value, 4)),
      low: result.bars.low.map((value) => round(value, 4)),
      close: result.bars.close.map((value) => round(value, 4)),
      volume: result.bars.volume,
    },
    heatmap: {
      ...result.heatmap,
      intensity: result.heatmap.intensity.map((value) => round(value, 3)),
      buy_ratio: [],
      profile_buy: result.heatmap.profile_buy.map((value) => Math.round(value)),
      profile_sell: result.heatmap.profile_sell.map((value) => Math.round(value)),
    },
  },
}

const text = JSON.stringify(recorded)
if (text.length > LIMIT_BYTES) throw new Error(`recorded run is ${text.length} bytes, over ${LIMIT_BYTES}`)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, text)
console.log(
  `wrote ${OUT}: ${(text.length / 1024).toFixed(0)} KB, ${events.length} events, ${result.bars.time.length} bars, ${result.result.trades.length} trades, verdict ${result.report.verdict.id}`,
)
