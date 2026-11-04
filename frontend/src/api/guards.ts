import {
  MARKETS,
  PROVIDER_KINDS,
  RUN_STATUSES,
  SOURCE_MODES,
  TIMEFRAMES,
  type CsvPreview,
  type CsvProblem,
  type CsvReport,
  type ErrorBody,
  type FieldProblem,
  type Health,
  type Limits,
  type Markets,
  type ParamDef,
  type ProviderInfo,
  type RunCreated,
  type RunStatusDocument,
  type SourceDescriptor,
  type StrategyMetadata,
  type Strategies,
} from './types'

export type Guard<T> = (value: unknown) => value is T

type Fields = Record<string, unknown>

export const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isInt = (value: unknown): value is number => isNumber(value) && Number.isInteger(value)
const isBool = (value: unknown): value is boolean => typeof value === 'boolean'
const nullable =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is T | null =>
    value === null || guard(value)
const oneOf =
  <T extends string>(options: readonly T[]) =>
  (value: unknown): value is T =>
    isString(value) && (options as readonly string[]).includes(value)
const arrayOf =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(guard)
const recordOf =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is Record<string, T> =>
    isObject(value) && Object.values(value).every(guard)
const isDate = (value: unknown): value is string => isString(value) && !Number.isNaN(Date.parse(value))

const isMarket = oneOf(MARKETS)
const isTimeframe = oneOf(TIMEFRAMES)

export const isHealth: Guard<Health> = (v): v is Health =>
  isObject(v) && isString(v.status) && isString(v.version)

export const isLimits: Guard<Limits> = (v): v is Limits =>
  isObject(v) &&
  recordOf(recordOf(isNumber))(v.range_days) &&
  isInt(v.csv_max_bytes) &&
  isInt(v.csv_max_rows) &&
  isInt(v.json_max_bytes) &&
  isInt(v.max_parameters) &&
  isObject(v.random_draws) &&
  isInt(v.random_draws.minimum) &&
  isInt(v.random_draws.maximum) &&
  isInt(v.random_draws.default) &&
  isInt(v.sweep_max_combinations) &&
  isInt(v.sweep_values_per_parameter) &&
  isNumber(v.run_timeout_seconds) &&
  isNumber(v.retention_minutes) &&
  isInt(v.runs_per_hour_per_ip) &&
  isInt(v.concurrent_runs_per_ip) &&
  isInt(v.max_result_bars) &&
  isInt(v.max_result_trades)

export const isProviderInfo: Guard<ProviderInfo> = (v): v is ProviderInfo =>
  isObject(v) &&
  isString(v.id) &&
  isString(v.display_name) &&
  oneOf(PROVIDER_KINDS)(v.kind) &&
  isBool(v.enabled) &&
  arrayOf(isMarket)(v.markets) &&
  arrayOf(isTimeframe)(v.timeframes) &&
  recordOf(isNumber)(v.max_range_days) &&
  nullable(recordOf(isNumber))(v.history_days) &&
  arrayOf(isString)(v.symbols) &&
  nullable(isString)(v.terms_url) &&
  isString(v.attribution) &&
  oneOf(SOURCE_MODES)(v.mode) &&
  isString(v.note)

export const isMarkets: Guard<Markets> = (v): v is Markets =>
  isObject(v) &&
  arrayOf((m): m is Markets['markets'][number] => isObject(m) && isMarket(m.id) && isString(m.label))(
    v.markets,
  ) &&
  arrayOf(isProviderInfo)(v.providers)

const isParamValue = (v: unknown): v is number | string => isNumber(v) || isString(v)

export const isParamDef: Guard<ParamDef> = (v): v is ParamDef =>
  isObject(v) &&
  isString(v.name) &&
  isString(v.label) &&
  oneOf(['int', 'float', 'choice'] as const)(v.type) &&
  isParamValue(v.default) &&
  nullable(isNumber)(v.minimum) &&
  nullable(isNumber)(v.maximum) &&
  nullable(isNumber)(v.step) &&
  nullable(arrayOf(isString))(v.choices) &&
  nullable(recordOf(isParamValue))(v.market_defaults) &&
  nullable(isString)(v.unit) &&
  isString(v.description) &&
  (v.type === 'choice' ? Array.isArray(v.choices) : isNumber(v.minimum) && isNumber(v.maximum) && isNumber(v.step))

export const isStrategy: Guard<StrategyMetadata> = (v): v is StrategyMetadata =>
  isObject(v) &&
  oneOf(['orb', 'vwap_mean_reversion', 'gap_fade', 'donchian_breakout', 'rsi_mean_reversion', 'custom'] as const)(
    v.id,
  ) &&
  isString(v.name) &&
  isString(v.summary) &&
  isString(v.idea) &&
  isString(v.works_when) &&
  isString(v.fails_when) &&
  arrayOf(isMarket)(v.markets) &&
  nullable(isString)(v.market_note) &&
  arrayOf(isTimeframe)(v.timeframes) &&
  arrayOf(isParamDef)(v.parameters) &&
  isObject(v.default_risk) &&
  isInt(v.default_risk.max_trades_per_session) &&
  nullable(recordOf(isNumber))(v.limits) &&
  isString(v.note)

export const isStrategies: Guard<Strategies> = (v): v is Strategies =>
  isObject(v) && arrayOf(isStrategy)(v.strategies)

export const isRunCreated: Guard<RunCreated> = (v): v is RunCreated =>
  isObject(v) &&
  isString(v.run_id) &&
  oneOf(RUN_STATUSES)(v.status) &&
  isString(v.events_url) &&
  isString(v.status_url) &&
  isString(v.result_url)

export const isRunStatus: Guard<RunStatusDocument> = (v): v is RunStatusDocument =>
  isObject(v) &&
  isString(v.run_id) &&
  oneOf(RUN_STATUSES)(v.status) &&
  nullable(isString)(v.stage) &&
  nullable(isString)(v.verdict) &&
  isDate(v.created_at) &&
  nullable(isDate)(v.started_at) &&
  nullable(isDate)(v.finished_at) &&
  isInt(v.events) &&
  (v.error === null ||
    (isObject(v.error) && isString(v.error.code) && isString(v.error.message) && nullable(isString)(v.error.stage))) &&
  isString(v.events_url) &&
  isString(v.result_url)

const isCsvProblem = (v: unknown): v is CsvProblem =>
  isObject(v) && nullable(isInt)(v.line) && nullable(isString)(v.column) && isString(v.code) && isString(v.message)

export const isCsvReport: Guard<CsvReport> = (v): v is CsvReport =>
  isObject(v) &&
  isInt(v.rows) &&
  arrayOf(isString)(v.columns) &&
  nullable(isString)(v.delimiter) &&
  recordOf(isString)(v.mapping) &&
  nullable(isString)(v.timestamp_format) &&
  nullable(isString)(v.timezone) &&
  nullable(isTimeframe)(v.timeframe) &&
  arrayOf(isCsvProblem)(v.problems) &&
  isInt(v.problem_count) &&
  arrayOf(isString)(v.warnings) &&
  arrayOf(isString)(v.rules)

const isSource = (v: unknown): v is SourceDescriptor =>
  isObject(v) &&
  isString(v.provider) &&
  isString(v.display_name) &&
  nullable(isString)(v.terms_url) &&
  isString(v.attribution) &&
  oneOf(SOURCE_MODES)(v.mode) &&
  isString(v.symbol) &&
  isMarket(v.market)

export const isCsvPreview: Guard<CsvPreview> = (v): v is CsvPreview =>
  isObject(v) &&
  isBool(v.ok) &&
  isCsvReport(v.report) &&
  nullable(isInt)(v.bar_count) &&
  nullable(isTimeframe)(v.timeframe) &&
  nullable(isDate)(v.start) &&
  nullable(isDate)(v.end) &&
  nullable(isSource)(v.source) &&
  isString(v.note)

export const isErrorBody: Guard<ErrorBody> = (v): v is ErrorBody =>
  isObject(v) && isString(v.code) && isInt(v.status) && isString(v.message) && isString(v.request_id)

export function fieldProblems(details: unknown): FieldProblem[] {
  if (!isObject(details) || !Array.isArray(details.problems)) return []
  return details.problems.filter(
    (p): p is FieldProblem => isObject(p) && isString(p.field) && isString(p.message),
  )
}

export function csvReportOf(details: unknown): CsvReport | null {
  if (!isObject(details)) return null
  return isCsvReport(details.csv_report) ? details.csv_report : null
}
