import type { CheckResult, HonestyReport, RandomEntries, RunResultPayload, SweepCell, SweepResult } from '../../api/result'
import { CHECK_LABELS, money, percent, profitFactor, toneOf } from './format'

export function checkTag(check: CheckResult): { state: CheckResult['status']; label: string; note: string | null } {
  return { state: check.status, label: check.status, note: check.insufficient_data ? 'insufficient data' : null }
}

export function failingChecks(report: HonestyReport): string[] {
  return report.checks.filter((check) => check.status === 'FAIL').map((check) => CHECK_LABELS[check.id])
}

export type Kpi = { label: string; value: string; tone: string; note?: string }

export function kpisOf(payload: RunResultPayload): Kpi[] {
  const summary = payload.result.metrics.summary
  const metrics = payload.result.metrics
  const best = payload.report.checks.find((check) => check.id === 'without_best_trade')
  const withoutBest = best?.measured.profit_factor_without_best
  return [
    { label: 'Net P&L', value: money(summary.net_pnl), tone: toneOf(summary.net_pnl), note: `${percent(summary.return_pct, 2)} of capital` },
    {
      label: 'Profit factor',
      value: profitFactor(summary.profit_factor),
      tone: 'text-ink',
      note: summary.profit_factor === null ? (summary.trade_count === 0 ? 'no trades' : 'no losing trade') : 'gross wins / gross losses',
    },
    {
      label: 'PF without best trade',
      value: profitFactor(typeof withoutBest === 'number' ? withoutBest : null),
      tone: 'text-ink',
      note: typeof withoutBest === 'number' ? 'best trade removed' : 'no losing trade left or too few trades',
    },
    { label: 'Win rate', value: percent(summary.win_rate_pct, 1), tone: 'text-ink', note: `${summary.trade_count.toLocaleString('en-US')} trades` },
    {
      label: 'Max drawdown',
      value: metrics.max_drawdown_pct > 0 ? `−${metrics.max_drawdown_pct.toFixed(2)}%` : '0.00%',
      tone: metrics.max_drawdown_pct > 0 ? 'text-loss-text' : 'text-ink',
      note: 'mark to market',
    },
    { label: 'Trades', value: summary.trade_count.toLocaleString('en-US'), tone: 'text-ink', note: `${payload.costs.fills.toLocaleString('en-US')} fills costed` },
  ]
}

export const WIDTH = 360
export const HEIGHT = 120
const PAD = { left: 6, right: 6, top: 8, bottom: 18 }

export function histogramGeometry(random: RandomEntries) {
  const histogram = random.histogram
  if (!histogram || histogram.counts.length === 0) return null
  const low = histogram.edges[0] ?? 0
  const high = histogram.edges.at(-1) ?? 1
  const span = high - low || 1
  const peak = Math.max(...histogram.counts, 1)
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const x = (value: number) => PAD.left + ((value - low) / span) * plotWidth
  const bars = histogram.counts.map((count, index) => {
    const left = x(histogram.edges[index] ?? low)
    const right = x(histogram.edges[index + 1] ?? high)
    const height = (count / peak) * plotHeight
    return { left, width: Math.max(0.5, right - left - 1), top: PAD.top + plotHeight - height, height, count, real: index === histogram.real_bin }
  })
  const realX = Math.min(WIDTH - PAD.right, Math.max(PAD.left, x(histogram.real_value)))
  return { bars, realX, low, high, baseline: PAD.top + plotHeight }
}

export function tint(value: number | null, maxAbs: number): string | undefined {
  if (value === null || value === 0 || maxAbs <= 0) return undefined
  const share = 12 + 33 * Math.min(1, Math.abs(value) / maxAbs)
  const colour = value > 0 ? 'var(--profit)' : 'var(--loss)'
  return `color-mix(in srgb, ${colour} ${share.toFixed(0)}%, var(--bg-panel))`
}

export function sweepGrid(sweep: SweepResult): { rows: (SweepCell | null)[][]; rowAxis: SweepResult['axes'][number]; columnAxis: SweepResult['axes'][number] | null } {
  const [rowAxis, columnAxis] = sweep.axes
  if (!rowAxis) return { rows: [], rowAxis: { name: '', label: '', values: [], chosen: 0 }, columnAxis: null }
  const columns = columnAxis ? columnAxis.values.length : 1
  const rows: (SweepCell | null)[][] = rowAxis.values.map(() => new Array<SweepCell | null>(columns).fill(null))
  for (const cell of sweep.cells) {
    const [row = 0, column = 0] = cell.coordinates
    const target = rows[row]
    if (target) target[column] = cell
  }
  return { rows, rowAxis, columnAxis: columnAxis ?? null }
}
