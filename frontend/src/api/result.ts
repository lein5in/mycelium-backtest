import type { CheckId, CheckStatus, Verdict } from './runEvents'
import type { CsvReport, GapReport, MarketKind, SourceDescriptor, Timeframe } from './types'

export type Side = 'long' | 'short'

export const EXIT_REASONS = ['stop', 'target', 'time_exit', 'exit_signal', 'risk_limit', 'end_of_data'] as const
export type ExitReason = (typeof EXIT_REASONS)[number]

export type TradeRow = {
  side: Side
  signal_index: number
  entry_index: number
  exit_index: number
  signal_time: string
  entry_time: string
  exit_time: string
  exit_fill: 'open' | 'intrabar' | 'close'
  session: string
  exit_session: string
  quantity: number
  entry_price: number
  exit_price: number
  stop_price: number | null
  target_price: number | null
  exit_reason: ExitReason
  gross_pnl: number
  fees: number
  slippage_cost: number
  net_pnl: number
  bars_held: number
}

export type TradeSummary = {
  trade_count: number
  net_pnl: number
  return_pct: number
  win_rate_pct: number | null
  average_win: number | null
  average_loss: number | null
  expectancy: number | null
  profit_factor: number | null
  longest_losing_streak: number
  realised_max_drawdown_pct: number
  realised_max_drawdown: number
}

export type Metrics = {
  summary: TradeSummary
  initial_capital: number
  final_equity: number
  max_drawdown_pct: number
  max_drawdown: number
  exposure_pct: number
  sharpe: number | null
  cagr_pct: number | null
  annual_volatility_pct: number | null
  annualisation_days: number
  period_days: number
}

export type DailyEquity = { session: string; equity: number; drawdown_pct: number }

export type EngineResult = {
  strategy: string
  market: MarketKind
  timeframe: Timeframe
  bar_count: number
  first_bar: string
  last_bar: string
  warmup_bars: number
  trades: TradeRow[]
  daily_equity: DailyEquity[]
  metrics: Metrics
  halted: unknown
  diagnostics: { signals: number; entries: number; skipped: Record<string, number> }
  assumptions: string[]
}

export type CheckResult = {
  id: CheckId
  status: CheckStatus
  headline: string
  detail: string
  insufficient_data: boolean
  measured: Record<string, number | string | boolean | null>
  thresholds: Record<string, number>
}

export type VerdictRule = { id: string; verdict: Verdict; description: string; matched: boolean }

export type Histogram = { edges: number[]; counts: number[]; real_value: number; real_bin: number }

export type RandomEntries = {
  draws: number
  seed: number
  trades_per_draw: number
  eligible_entry_bars: number
  real_net_pnl: number
  percentile: number | null
  mean: number | null
  median: number | null
  p5: number | null
  p95: number | null
  histogram: Histogram | null
}

export type PartStatus = CheckStatus | 'not_run'

export type PeriodBlock = {
  index: number
  first_trade: number
  last_trade: number
  trade_count: number
  start: string | null
  end: string | null
  net_pnl: number
  share_of_profit: number | null
}

export type SweepAxis = { name: string; label: string; values: number[]; chosen: number }

export type SweepCell = {
  coordinates: number[]
  values: Record<string, number>
  state: 'ok' | 'invalid' | 'not_run'
  net_pnl: number | null
  profit_factor: number | null
  trade_count: number | null
  message?: string | null
}

export type SweepResult = {
  axes: SweepAxis[]
  cells: SweepCell[]
  chosen: number[]
  best: number[] | null
  combinations: number
  completed: number
  stopped_by_budget: boolean
  elapsed_seconds: number
  neighbour_count: number
  profitable_neighbour_fraction: number | null
  neighbour_median_share: number | null
  chosen_is_spike: boolean
  best_is_spike: boolean
}

export type CalendarDayKind = 'session' | 'closed' | 'no_data' | 'other_month'

export type CalendarDay = { date: string; kind: CalendarDayKind; net_pnl: number | null; trades: number | null }

export type CalendarWeek = { monday: string; days: CalendarDay[]; net_pnl: number; trades: number }

export type CalendarMonth = {
  month: string
  weeks: CalendarWeek[]
  net_pnl: number
  trades: number
  green_weeks: number
  weeks_with_trades: number
  best_day: string | null
  best_day_pnl: number | null
  worst_day: string | null
  worst_day_pnl: number | null
}

export type PnlCalendar = { rule: string; timezone: string; months: CalendarMonth[] }

export type HonestyReport = {
  run: {
    strategy_id: string
    strategy_name: string
    parameters: Record<string, number | string>
    market: MarketKind
    timeframe: Timeframe
    first_bar: string
    last_bar: string
    bar_count: number
    trade_count: number
  }
  checks: CheckResult[]
  verdict: { id: Verdict; label: string; rule: string; sentence: string; rules: VerdictRule[] }
  config: Record<string, number | string | boolean>
  random_entries: RandomEntries
  robustness: {
    period: {
      status: PartStatus
      insufficient_data: boolean
      blocks: PeriodBlock[]
      max_share: number | null
      positive_fraction: number | null
      total_net_pnl: number
    }
    parameters: { status: PartStatus; insufficient_data: boolean; reason: string }
  }
  sweep: SweepResult | null
  calendar: PnlCalendar
  assumptions: string[]
}

export type ResultHeatmap = {
  mode: 'FROM_TRADES' | 'ESTIMATED_FROM_CANDLES'
  time_bucket_seconds: number
  price_bucket: number
  columns: number
  rows: number
  first_time: number
  lowest_price: number
  intensity: number[]
  buy_ratio: number[]
  profile_buy: number[]
  profile_sell: number[]
  poc_row: number | null
  poc_price: number | null
  total_volume: number
  method: { label: string; volume_rule: string; normalisation: string }
}

export type BarColumns = {
  time: number[]
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
}

export type Truncation = {
  bars_total: number
  bars_returned: number
  bars_first_index: number
  bars_truncated: boolean
  trades_total: number
  trades_returned: number
  trades_truncated: boolean
  note: string | null
}

export type RunRequestDocument = {
  strategy_id: string
  parameters: Record<string, number | string> | null
  costs: { fee_pct: number; fixed_fee: number; slippage: { unit: string; value: number } } | null
  risk: {
    max_trades_per_session: number
    max_session_loss_pct: number | null
    max_drawdown_pct: number | null
  } | null
  sizing: { type: string; fraction?: number; percent?: number } | null
  initial_capital: number
  tick_size?: number | null
  quantity_step?: number | null
  session_anchor?: string | null
  honesty: { random_draws: number; seed: number; sweep: boolean } | null
  data?: { provider: string; symbol: string; timeframe: Timeframe; start: string; end: string }
  csv?: { market: MarketKind; timeframe?: Timeframe }
}

export type RunResultPayload = {
  schema_version: 1
  run_id: string
  request: RunRequestDocument
  source: SourceDescriptor
  gaps: GapReport
  data_warnings: string[]
  csv_report: CsvReport | null
  result: EngineResult
  report: HonestyReport
  heatmap: ResultHeatmap
  costs: { fills: number; fees: number; slippage: number; gross_pnl: number; net_pnl: number }
  bars: BarColumns
  limits: Truncation
}

type Fields = Record<string, unknown>

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumberArray = (value: unknown, length?: number) =>
  Array.isArray(value) && (length === undefined || value.length === length) && value.every((item) => typeof item === 'number')

function isBars(value: unknown): value is BarColumns {
  if (!isObject(value) || !Array.isArray(value.time)) return false
  const length = value.time.length
  return (['time', 'open', 'high', 'low', 'close', 'volume'] as const).every((key) => isNumberArray(value[key], length))
}

function isHeatmap(value: unknown): value is ResultHeatmap {
  if (!isObject(value)) return false
  const { columns, rows } = value
  if (typeof columns !== 'number' || typeof rows !== 'number') return false
  return (
    (value.mode === 'FROM_TRADES' || value.mode === 'ESTIMATED_FROM_CANDLES') &&
    isNumberArray(value.intensity, columns * rows) &&
    isNumberArray(value.buy_ratio, columns * rows) &&
    isNumberArray(value.profile_buy, rows) &&
    isNumberArray(value.profile_sell, rows) &&
    typeof value.time_bucket_seconds === 'number' &&
    typeof value.price_bucket === 'number' &&
    typeof value.first_time === 'number' &&
    typeof value.lowest_price === 'number'
  )
}

function isReport(value: unknown): value is HonestyReport {
  return (
    isObject(value) &&
    Array.isArray(value.checks) &&
    value.checks.length === 6 &&
    isObject(value.verdict) &&
    Array.isArray(value.verdict.rules) &&
    isObject(value.random_entries) &&
    isObject(value.robustness) &&
    isObject(value.calendar) &&
    Array.isArray(value.calendar.months) &&
    Array.isArray(value.assumptions)
  )
}

export function isRunResult(value: unknown): value is RunResultPayload {
  if (!isObject(value) || value.schema_version !== 1 || typeof value.run_id !== 'string') return false
  const result = value.result
  return (
    isObject(value.request) &&
    isObject(value.source) &&
    isObject(result) &&
    Array.isArray(result.trades) &&
    Array.isArray(result.daily_equity) &&
    isObject(result.metrics) &&
    isObject(result.metrics.summary) &&
    isReport(value.report) &&
    isHeatmap(value.heatmap) &&
    isBars(value.bars) &&
    isObject(value.limits) &&
    isObject(value.costs)
  )
}
