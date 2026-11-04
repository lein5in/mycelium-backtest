import type { FieldProblem, Limits, MarketKind, ParamDef, ProviderInfo, StrategyMetadata, Timeframe } from '../../api/types'

export type SourceKind = 'crypto' | 'stocks' | 'csv'

export const SOURCE_LABELS: Record<SourceKind, string> = {
  crypto: 'Crypto',
  stocks: 'Stocks & ETFs',
  csv: 'CSV import',
}

export const MARKET_LABELS: Record<MarketKind, string> = {
  us_equity: 'Stocks & ETFs',
  crypto_24x7: 'Crypto 24/7',
}

export type ConfigState = {
  source: SourceKind
  provider: string
  symbol: string
  timeframe: Timeframe
  start: string
  end: string
  csvMarket: MarketKind
  strategyId: string
  params: Record<string, string>
  feePct: string
  fixedFee: string
  slippageBps: string
  maxTradesPerSession: string
  maxSessionLossPct: string
  maxDrawdownPct: string
  sizingPct: string
  capital: string
  randomDraws: string
  sweep: boolean
  seed: string
}

export type FieldErrors = Record<string, string>

const MINUTES: Record<Timeframe, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 }
const DAY_MS = 86_400_000

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function providersFor(source: SourceKind, providers: ProviderInfo[]): ProviderInfo[] {
  if (source === 'csv') return []
  const market: MarketKind = source === 'crypto' ? 'crypto_24x7' : 'us_equity'
  return providers.filter(
    (info) => info.enabled && (info.kind === 'candles' || info.kind === 'sample') && info.markets.includes(market),
  )
}

export function marketOf(state: Pick<ConfigState, 'source' | 'csvMarket'>): MarketKind {
  if (state.source === 'csv') return state.csvMarket
  return state.source === 'crypto' ? 'crypto_24x7' : 'us_equity'
}

export type Compatibility = { ok: true } | { ok: false; reason: string }

export function compatibility(strategy: StrategyMetadata, market: MarketKind): Compatibility {
  if (strategy.id === 'custom') return { ok: false, reason: 'The custom strategy builder comes in a later release.' }
  if (strategy.markets.includes(market)) return { ok: true }
  const supported = strategy.markets.map((item) => MARKET_LABELS[item]).join(' and ')
  return { ok: false, reason: `${strategy.name} supports ${supported} only. ${strategy.market_note ?? ''}`.trim() }
}

export function defaultValue(definition: ParamDef, market: MarketKind): string {
  const value = definition.market_defaults?.[market] ?? definition.default
  return String(value)
}

export function defaultParams(strategy: StrategyMetadata | undefined, market: MarketKind): Record<string, string> {
  if (!strategy) return {}
  return Object.fromEntries(strategy.parameters.map((definition) => [definition.name, defaultValue(definition, market)]))
}

export function defaultDates(source: SourceKind, today: Date = new Date()): { start: string; end: string } {
  if (source === 'stocks') return { start: '2024-01-02', end: '2024-04-01' }
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return { start: isoDate(new Date(end.getTime() - 60 * DAY_MS)), end: isoDate(end) }
}

export function initialState(
  providers: ProviderInfo[],
  strategies: StrategyMetadata[],
  today: Date = new Date(),
): ConfigState {
  const source: SourceKind = 'stocks'
  const provider = providersFor(source, providers)[0]
  const market = marketOf({ source, csvMarket: 'us_equity' })
  const strategy = strategies.find((item) => item.id === 'orb') ?? strategies[0]
  return {
    source,
    provider: provider?.id ?? '',
    symbol: provider?.symbols[0] ?? '',
    timeframe: provider?.timeframes.includes('5m') ? '5m' : (provider?.timeframes[0] ?? '5m'),
    ...defaultDates(source, today),
    csvMarket: 'us_equity',
    strategyId: strategy?.id ?? '',
    params: defaultParams(strategy, market),
    feePct: '0.05',
    fixedFee: '0',
    slippageBps: '2',
    maxTradesPerSession: String(strategy?.default_risk.max_trades_per_session ?? 1),
    maxSessionLossPct: '',
    maxDrawdownPct: '',
    sizingPct: '100',
    capital: '10000',
    randomDraws: '1000',
    sweep: true,
    seed: '1',
  }
}

export function switchSource(
  state: ConfigState,
  source: SourceKind,
  providers: ProviderInfo[],
  strategies: StrategyMetadata[],
  today: Date = new Date(),
): ConfigState {
  const provider = providersFor(source, providers)[0]
  const next: ConfigState = {
    ...state,
    source,
    provider: provider?.id ?? '',
    symbol: provider?.symbols[0] ?? '',
    timeframe: provider?.timeframes.includes(source === 'crypto' ? '1h' : '5m')
      ? source === 'crypto'
        ? '1h'
        : '5m'
      : (provider?.timeframes[0] ?? state.timeframe),
    ...defaultDates(source, today),
  }
  return withStrategy(next, next.strategyId, strategies)
}

export function withProvider(state: ConfigState, providerId: string, providers: ProviderInfo[]): ConfigState {
  const provider = providers.find((info) => info.id === providerId)
  if (!provider) return state
  return {
    ...state,
    provider: provider.id,
    symbol: provider.symbols.includes(state.symbol) ? state.symbol : (provider.symbols[0] ?? ''),
    timeframe: provider.timeframes.includes(state.timeframe) ? state.timeframe : (provider.timeframes[0] ?? state.timeframe),
  }
}

export function withStrategy(state: ConfigState, strategyId: string, strategies: StrategyMetadata[]): ConfigState {
  const strategy = strategies.find((item) => item.id === strategyId)
  return {
    ...state,
    strategyId,
    params: defaultParams(strategy, marketOf(state)),
    maxTradesPerSession: String(strategy?.default_risk.max_trades_per_session ?? state.maxTradesPerSession),
  }
}

function decimals(value: number): number {
  const text = String(value)
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0
}

export function paramError(definition: ParamDef, raw: string): string | null {
  if (definition.type === 'choice') {
    return definition.choices?.includes(raw) ? null : `Choose one of ${definition.choices?.join(', ')}.`
  }
  if (raw.trim() === '') return 'Enter a value.'
  const value = Number(raw)
  if (!Number.isFinite(value)) return 'Enter a number.'
  if (definition.type === 'int' && !Number.isInteger(value)) return 'Enter a whole number.'
  const { minimum, maximum, step } = definition
  if (minimum !== null && value < minimum) return `At least ${minimum}.`
  if (maximum !== null && value > maximum) return `At most ${maximum}.`
  if (step && minimum !== null) {
    const steps = (value - minimum) / step
    const precision = Math.max(decimals(step), decimals(minimum))
    if (Math.abs(steps - Math.round(steps)) > 1e-9 * Math.max(1, Math.abs(steps))) {
      return `Use steps of ${step.toFixed(precision)} from ${minimum}.`
    }
  }
  return null
}

export function paramValue(definition: ParamDef, raw: string): number | string {
  return definition.type === 'choice' ? raw : Number(raw)
}

function numberError(raw: string, min: number, max: number, options: { optional?: boolean; integer?: boolean } = {}) {
  if (raw.trim() === '') return options.optional ? null : 'Enter a value.'
  const value = Number(raw)
  if (!Number.isFinite(value)) return 'Enter a number.'
  if (options.integer && !Number.isInteger(value)) return 'Enter a whole number.'
  if (value < min || value > max) return `Between ${min} and ${max}.`
  return null
}

export function daysBetween(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS
}

export function rangeError(state: ConfigState, provider: ProviderInfo | undefined, limits: Limits): string | null {
  if (state.source === 'csv') return null
  if (!state.start || !state.end) return 'Pick a start and an end date.'
  const days = daysBetween(state.start, state.end)
  if (!Number.isFinite(days)) return 'Pick valid dates.'
  if (days <= 0) return 'The end must be after the start.'
  const limit = limits.range_days[state.provider]?.[state.timeframe] ?? provider?.max_range_days[state.timeframe]
  if (limit !== undefined && days > limit) {
    return `${state.timeframe} data is limited to ${limit} days per run; this range is ${Math.round(days)} days.`
  }
  return null
}

export function validate(
  state: ConfigState,
  strategy: StrategyMetadata | undefined,
  provider: ProviderInfo | undefined,
  limits: Limits,
): FieldErrors {
  const errors: FieldErrors = {}
  const add = (key: string, message: string | null) => {
    if (message) errors[key] = message
  }
  if (state.source !== 'csv') {
    if (!provider) errors['data.provider'] = 'Choose a data source.'
    else if (!provider.symbols.includes(state.symbol)) errors['data.symbol'] = 'Choose one of the listed symbols.'
    add('data.end', rangeError(state, provider, limits))
  }
  if (!strategy) errors.strategy_id = 'Choose a strategy.'
  else {
    const compatible = compatibility(strategy, marketOf(state))
    if (!compatible.ok) errors.strategy_id = compatible.reason
    for (const definition of strategy.parameters) {
      add(`parameters.${definition.name}`, paramError(definition, state.params[definition.name] ?? ''))
    }
  }
  add('costs.fee_pct', numberError(state.feePct, 0, 5))
  add('costs.fixed_fee', numberError(state.fixedFee, 0, 10_000))
  add('costs.slippage.value', numberError(state.slippageBps, 0, 1_000))
  add('risk.max_trades_per_session', numberError(state.maxTradesPerSession, 1, 1_000, { integer: true }))
  add('risk.max_session_loss_pct', numberError(state.maxSessionLossPct, 0.01, 100, { optional: true }))
  add('risk.max_drawdown_pct', numberError(state.maxDrawdownPct, 0.01, 100, { optional: true }))
  add('sizing.fraction', numberError(state.sizingPct, 0.01, 100))
  add('initial_capital', numberError(state.capital, 1, 1_000_000_000))
  add(
    'honesty.random_draws',
    numberError(state.randomDraws, limits.random_draws.minimum, limits.random_draws.maximum, { integer: true }),
  )
  add('honesty.seed', numberError(state.seed, 0, 4_294_967_295, { integer: true }))
  return errors
}

const optionalNumber = (raw: string) => (raw.trim() === '' ? null : Number(raw))

export function runOptions(state: ConfigState, strategy: StrategyMetadata) {
  return {
    strategy_id: strategy.id,
    parameters: Object.fromEntries(
      strategy.parameters.map((definition) => [definition.name, paramValue(definition, state.params[definition.name] ?? '')]),
    ),
    costs: {
      fee_pct: Number(state.feePct),
      fixed_fee: Number(state.fixedFee),
      slippage: { unit: 'bps', value: Number(state.slippageBps) },
    },
    risk: {
      max_trades_per_session: Number(state.maxTradesPerSession),
      max_session_loss_pct: optionalNumber(state.maxSessionLossPct),
      max_drawdown_pct: optionalNumber(state.maxDrawdownPct),
    },
    sizing: { type: 'fixed_fraction', fraction: Number(state.sizingPct) / 100 },
    initial_capital: Number(state.capital),
    honesty: { random_draws: Number(state.randomDraws), sweep: state.sweep, seed: Number(state.seed) },
  }
}

export function runBody(state: ConfigState, strategy: StrategyMetadata) {
  return {
    ...runOptions(state, strategy),
    data: {
      provider: state.provider,
      symbol: state.symbol,
      timeframe: state.timeframe,
      start: `${state.start}T00:00:00Z`,
      end: `${state.end}T00:00:00Z`,
    },
  }
}

export function csvRunOptions(state: ConfigState, strategy: StrategyMetadata, timeframe: Timeframe | null) {
  return {
    ...runOptions(state, strategy),
    csv: { market: state.csvMarket, ...(timeframe ? { timeframe } : {}) },
  }
}

export function estimatedBars(state: ConfigState): number | null {
  if (state.source === 'csv') return null
  const days = daysBetween(state.start, state.end)
  if (!Number.isFinite(days) || days <= 0) return null
  const minutes = MINUTES[state.timeframe]
  if (state.source === 'crypto') return Math.floor((days * 1440) / minutes)
  const sessions = Math.round((days * 252) / 365)
  return state.timeframe === '1d' ? sessions : Math.round((sessions * 390) / minutes)
}

export function serverFieldErrors(problems: FieldProblem[], strategy: StrategyMetadata | undefined): FieldErrors {
  const errors: FieldErrors = {}
  for (const problem of problems) {
    let key = problem.field
    if (key === 'parameters' && strategy) {
      const owner = strategy.parameters.find((definition) => problem.message.startsWith(definition.name))
      if (owner) key = `parameters.${owner.name}`
    }
    if (key === 'data.start') key = 'data.end'
    errors[key] = errors[key] ? `${errors[key]} ${problem.message}` : problem.message
  }
  return errors
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}
