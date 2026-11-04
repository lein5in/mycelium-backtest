export const MARKETS = ['us_equity', 'crypto_24x7'] as const
export type MarketKind = (typeof MARKETS)[number]

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export const SOURCE_MODES = ['PUBLIC EXCHANGE DATA', 'SAMPLE DATA', 'USER CSV', 'PERSONAL USE ONLY'] as const
export type SourceMode = (typeof SOURCE_MODES)[number]

export const PROVIDER_KINDS = ['candles', 'trades', 'sample', 'csv'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export const RUN_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export type Health = { status: string; version: string }

export type Limits = {
  range_days: Record<string, Record<string, number>>
  csv_max_bytes: number
  csv_max_rows: number
  json_max_bytes: number
  max_parameters: number
  random_draws: { minimum: number; maximum: number; default: number }
  sweep_max_combinations: number
  sweep_values_per_parameter: number
  run_timeout_seconds: number
  retention_minutes: number
  runs_per_hour_per_ip: number
  concurrent_runs_per_ip: number
  max_result_bars: number
  max_result_trades: number
}

export type ProviderInfo = {
  id: string
  display_name: string
  kind: ProviderKind
  enabled: boolean
  markets: MarketKind[]
  timeframes: Timeframe[]
  max_range_days: Record<string, number>
  history_days: Record<string, number> | null
  symbols: string[]
  terms_url: string | null
  attribution: string
  mode: SourceMode
  note: string
}

export type Markets = { markets: { id: MarketKind; label: string }[]; providers: ProviderInfo[] }

export type ParamValue = number | string

export type ParamDef = {
  name: string
  label: string
  type: 'int' | 'float' | 'choice'
  default: ParamValue
  minimum: number | null
  maximum: number | null
  step: number | null
  choices: string[] | null
  market_defaults: Partial<Record<MarketKind, ParamValue>> | null
  unit: string | null
  description: string
}

export type RiskLimits = {
  max_session_loss_pct: number | null
  max_drawdown_pct: number | null
  max_trades_per_session: number
}

export type StrategyId =
  | 'orb'
  | 'vwap_mean_reversion'
  | 'gap_fade'
  | 'donchian_breakout'
  | 'rsi_mean_reversion'
  | 'custom'

export type StrategyMetadata = {
  id: StrategyId
  name: string
  summary: string
  idea: string
  works_when: string
  fails_when: string
  markets: MarketKind[]
  market_note: string | null
  timeframes: Timeframe[]
  parameters: ParamDef[]
  default_risk: RiskLimits
  limits: Record<string, number> | null
  note: string
}

export type Strategies = { strategies: StrategyMetadata[] }

export type RunCreated = {
  run_id: string
  status: RunStatus
  events_url: string
  status_url: string
  result_url: string
}

export type RunErrorInfo = { code: string; message: string; stage: string | null; details?: unknown }

export type RunStatusDocument = {
  run_id: string
  status: RunStatus
  stage: string | null
  verdict: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  events: number
  error: RunErrorInfo | null
  events_url: string
  result_url: string
}

export type CsvProblem = { line: number | null; column: string | null; code: string; message: string }

export type GapReport = { missing_bars: number; gap_count: number; gaps: unknown[]; note: string }

export type CsvReport = {
  rows: number
  columns: string[]
  delimiter: string | null
  mapping: Record<string, string>
  timestamp_format: string | null
  timezone: string | null
  timeframe: Timeframe | null
  problems: CsvProblem[]
  problem_count: number
  warnings: string[]
  gaps: GapReport | null
  rules: string[]
}

export type SourceDescriptor = {
  provider: string
  display_name: string
  terms_url: string | null
  attribution: string
  mode: SourceMode
  symbol: string
  market: MarketKind
  timeframe: Timeframe | null
  start: string | null
  end: string | null
}

export type CsvPreview = {
  ok: boolean
  report: CsvReport
  bar_count: number | null
  timeframe: Timeframe | null
  start: string | null
  end: string | null
  source: SourceDescriptor | null
  note: string
}

export type FieldProblem = { field: string; message: string }

export type ErrorBody = {
  code: string
  status: number
  message: string
  stage: string | null
  details: unknown
  request_id: string
}
