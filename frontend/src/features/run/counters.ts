import type { RunResultPayload } from '../../api/result'
import type { CheckStatus, RunEvent, TradeCluster } from '../../api/runEvents'
import { count, money, percent } from '../report/format'

export type Counter = { label: string; value: string; source: 'events' | 'result' | 'pending'; tone?: 'profit' | 'loss' }

export type Counters = {
  trades: Counter
  clusters: Counter
  bars: Counter
  checks: Counter
  equity: Counter
  drawdown: Counter
  winRate: Counter
}

const PENDING = '—'

export function drawdownText(value: number): string {
  return value > 0 ? `−${value.toFixed(2)}%` : '0.00%'
}

export function deriveCounters(events: readonly RunEvent[], result: RunResultPayload | null): Counters {
  const clusters = events.filter((event): event is TradeCluster => event.type === 'trade_cluster')
  const fills = clusters.reduce((sum, cluster) => sum + cluster.fills, 0)
  const started = events.find((event) => event.type === 'run_started')
  const barCount = started?.type === 'run_started' ? started.bar_count : null
  let lastBar: number | null = null
  for (const event of events) {
    if (event.type === 'stage_progress' && event.bar_index !== null) lastBar = event.bar_index
  }
  const simulatorDone = events.some((event) => event.type === 'stage_done' && event.stage === 'SIMULATOR')
  const statuses: Record<CheckStatus, number> = { PASS: 0, WARN: 0, FAIL: 0 }
  for (const event of events) if (event.type === 'check_done') statuses[event.status] += 1
  const checked = statuses.PASS + statuses.WARN + statuses.FAIL
  const summary = result?.result.metrics.summary
  const metrics = result?.result.metrics
  const net = summary?.net_pnl ?? null
  return {
    trades: { label: 'Trades closed', value: count(fills / 2), source: 'events' },
    clusters: { label: 'Clusters', value: count(clusters.length), source: 'events' },
    bars: {
      label: 'Bars simulated',
      value:
        barCount === null
          ? PENDING
          : `${count(simulatorDone ? barCount : lastBar === null ? 0 : lastBar + 1)} / ${count(barCount)}`,
      source: 'events',
    },
    checks: {
      label: 'Checks',
      value: checked === 0 ? '0 / 6' : `${checked} / 6 · ${statuses.PASS} pass · ${statuses.WARN} warn · ${statuses.FAIL} fail`,
      source: 'events',
    },
    equity: metrics
      ? {
          label: 'Final equity',
          value: `${metrics.final_equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${money(net)})`,
          source: 'result',
          tone: net !== null && net < 0 ? 'loss' : 'profit',
        }
      : { label: 'Final equity', value: PENDING, source: 'pending' },
    drawdown: metrics
      ? { label: 'Max drawdown', value: drawdownText(metrics.max_drawdown_pct), source: 'result', tone: 'loss' }
      : { label: 'Max drawdown', value: PENDING, source: 'pending' },
    winRate: summary
      ? { label: 'Win rate', value: percent(summary.win_rate_pct, 1), source: 'result' }
      : { label: 'Win rate', value: PENDING, source: 'pending' },
  }
}
