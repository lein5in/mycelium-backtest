export const RUN_EVENTS_SCHEMA_VERSION = 2
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const
export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number]

export const STAGES = ['DATA', 'SIGNALS', 'SIMULATOR', 'COSTS', 'AUDITOR', 'REPORTER'] as const
export type Stage = (typeof STAGES)[number]

export const CHECK_IDS = [
  'costs',
  'trade_count',
  'without_best_trade',
  'out_of_sample',
  'versus_random',
  'robustness',
] as const
export type CheckId = (typeof CHECK_IDS)[number]

export const CHECK_STATUSES = ['PASS', 'WARN', 'FAIL'] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

export const VERDICTS = ['CREDIBLE', 'FRAGILE', 'NOT_CREDIBLE'] as const
export type Verdict = (typeof VERDICTS)[number]

type Envelope = {
  schema_version: SchemaVersion
  run_id: string
  seq: number
  ts: string
}

export type ClusterRegion = {
  start_bar: number
  end_bar: number
  price_low: number
  price_high: number
}

export type RunStarted = Envelope & { type: 'run_started'; bar_count: number }
export type StageStarted = Envelope & { type: 'stage_started'; stage: Stage }
export type StageProgress = Envelope & {
  type: 'stage_progress'
  stage: Stage
  progress: number
  detail: string | null
  bar_index: number | null
}
export type StageDone = Envelope & { type: 'stage_done'; stage: Stage; detail: string | null }
export type TradeCluster = Envelope & {
  type: 'trade_cluster'
  region: ClusterRegion
  fills: number
  net_result: number
}
export type CheckDone = Envelope & {
  type: 'check_done'
  check_id: CheckId
  status: CheckStatus
  figure: string
}
export type RunDone = Envelope & { type: 'run_done'; verdict: Verdict }
export type RunFailed = Envelope & {
  type: 'run_failed'
  stage: Stage
  message: string
  code?: string | null
}

export type RunEvent =
  | RunStarted
  | StageStarted
  | StageProgress
  | StageDone
  | TradeCluster
  | CheckDone
  | RunDone
  | RunFailed

type Fields = Record<string, unknown>

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)

const isOptionalString = (value: unknown) => value === null || typeof value === 'string'

const isRegion = (value: unknown): value is ClusterRegion =>
  isObject(value) &&
  isNonNegativeInt(value.start_bar) &&
  isNonNegativeInt(value.end_bar) &&
  value.end_bar >= value.start_bar &&
  isFraction(value.price_low) &&
  isFraction(value.price_high) &&
  value.price_high >= value.price_low

const bodyChecks: Record<RunEvent['type'], (event: Fields) => boolean> = {
  run_started: (e) => isNonNegativeInt(e.bar_count) && e.bar_count > 0,
  stage_started: (e) => isOneOf(STAGES, e.stage),
  stage_progress: (e) =>
    isOneOf(STAGES, e.stage) &&
    isNonNegativeInt(e.progress) &&
    e.progress <= 100 &&
    isOptionalString(e.detail) &&
    (e.bar_index === null || isNonNegativeInt(e.bar_index)),
  stage_done: (e) => isOneOf(STAGES, e.stage) && isOptionalString(e.detail),
  trade_cluster: (e) =>
    isRegion(e.region) &&
    isNonNegativeInt(e.fills) &&
    e.fills > 0 &&
    typeof e.net_result === 'number' &&
    Number.isFinite(e.net_result),
  check_done: (e) =>
    isOneOf(CHECK_IDS, e.check_id) &&
    isOneOf(CHECK_STATUSES, e.status) &&
    typeof e.figure === 'string',
  run_done: (e) => isOneOf(VERDICTS, e.verdict),
  run_failed: (e) =>
    isOneOf(STAGES, e.stage) &&
    typeof e.message === 'string' &&
    (e.code === undefined || isOptionalString(e.code)),
}

const eventTypes = Object.keys(bodyChecks) as RunEvent['type'][]

export function isRunEvent(value: unknown): value is RunEvent {
  if (!isObject(value)) return false
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(value.schema_version)) return false
  if (typeof value.run_id !== 'string' || value.run_id.length === 0) return false
  if (!isNonNegativeInt(value.seq)) return false
  if (typeof value.ts !== 'string' || Number.isNaN(Date.parse(value.ts))) return false
  if (!isOneOf(eventTypes, value.type)) return false
  return bodyChecks[value.type](value)
}

export function parseRunEvent(data: string): RunEvent | null {
  try {
    const value: unknown = JSON.parse(data)
    return isRunEvent(value) ? value : null
  } catch {
    return null
  }
}
