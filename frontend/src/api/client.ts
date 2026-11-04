import {
  isCsvPreview,
  isErrorBody,
  isHealth,
  isLimits,
  isMarkets,
  isRunCreated,
  isRunStatus,
  isStrategies,
  type Guard,
} from './guards'
import type { CsvPreview, Health, Limits, Markets, RunCreated, RunStatusDocument, Strategies } from './types'

export const CLIENT_CODES = ['engine_unreachable', 'request_timeout', 'bad_response', 'aborted'] as const

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly stage: string | null
  readonly details: unknown
  readonly requestId: string | null
  readonly retryAfter: number | null

  constructor(init: {
    code: string
    status: number
    message: string
    stage?: string | null
    details?: unknown
    requestId?: string | null
    retryAfter?: number | null
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.code = init.code
    this.status = init.status
    this.stage = init.stage ?? null
    this.details = init.details ?? null
    this.requestId = init.requestId ?? null
    this.retryAfter = init.retryAfter ?? null
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000

const apiBase: string = import.meta.env.VITE_API_BASE_URL ?? ''

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE'
  json?: unknown
  form?: FormData
  signal?: AbortSignal
  timeoutMs?: number
  fetcher?: typeof fetch
}

function retryAfterOf(response: Response): number | null {
  const header = response.headers.get('Retry-After')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null
}

export async function request<T>(path: string, guard: Guard<T>, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)
  const init: RequestInit = { method: options.method ?? 'GET', signal: controller.signal }
  if (options.json !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(options.json)
  } else if (options.form) {
    init.body = options.form
  }
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(`${apiBase}${path}`, init)
  } catch {
    if (timedOut) {
      throw new ApiError({ code: 'request_timeout', status: 0, message: 'The engine did not answer in time.' })
    }
    if (options.signal?.aborted) {
      throw new ApiError({ code: 'aborted', status: 0, message: 'The request was cancelled.' })
    }
    throw new ApiError({ code: 'engine_unreachable', status: 0, message: 'The engine could not be reached.' })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new ApiError({
        code: body.code,
        status: response.status,
        message: body.message,
        stage: body.stage,
        details: body.details,
        requestId: body.request_id,
        retryAfter: retryAfterOf(response),
      })
    }
    const unreachable = response.status === 502 || response.status === 504
    throw new ApiError({
      code: unreachable ? 'engine_unreachable' : 'bad_response',
      status: response.status,
      message: unreachable ? 'The engine could not be reached.' : 'The engine sent an unexpected answer.',
      requestId: response.headers.get('X-Request-ID'),
    })
  }
  if (!guard(body)) {
    throw new ApiError({
      code: 'bad_response',
      status: response.status,
      message: 'The engine sent an answer this page cannot read.',
      requestId: response.headers.get('X-Request-ID'),
    })
  }
  return body
}

export const getHealth = (options?: RequestOptions): Promise<Health> =>
  request('/api/health', isHealth, { timeoutMs: 5_000, ...options })
export const getLimits = (options?: RequestOptions): Promise<Limits> => request('/api/limits', isLimits, options)
export const getMarkets = (options?: RequestOptions): Promise<Markets> => request('/api/markets', isMarkets, options)
export const getStrategies = (options?: RequestOptions): Promise<Strategies> =>
  request('/api/strategies', isStrategies, options)
export const getRunStatus = (runId: string, options?: RequestOptions): Promise<RunStatusDocument> =>
  request(`/api/runs/${encodeURIComponent(runId)}`, isRunStatus, options)
export const cancelRun = (runId: string, options?: RequestOptions): Promise<RunStatusDocument> =>
  request(`/api/runs/${encodeURIComponent(runId)}`, isRunStatus, { ...options, method: 'DELETE' })

export const postRun = (body: unknown, options?: RequestOptions): Promise<RunCreated> =>
  request('/api/runs', isRunCreated, { ...options, method: 'POST', json: body, timeoutMs: 30_000 })

export type CsvUpload = { file: File; timezone: string | null; columns: Record<string, string> | null }

function csvForm(upload: CsvUpload, options: unknown): FormData {
  const form = new FormData()
  form.append('options', JSON.stringify(options))
  if (upload.timezone) form.append('timezone', upload.timezone)
  if (upload.columns) form.append('columns', JSON.stringify(upload.columns))
  form.append('file', upload.file, upload.file.name)
  return form
}

export const previewCsv = (upload: CsvUpload, csvOptions: unknown, options?: RequestOptions): Promise<CsvPreview> =>
  request('/api/csv/preview', isCsvPreview, {
    ...options,
    method: 'POST',
    form: csvForm(upload, csvOptions),
    timeoutMs: 60_000,
  })

export const postCsvRun = (upload: CsvUpload, runOptions: unknown, options?: RequestOptions): Promise<RunCreated> =>
  request('/api/runs/csv', isRunCreated, {
    ...options,
    method: 'POST',
    form: csvForm(upload, runOptions),
    timeoutMs: 60_000,
  })

export const eventsUrl = (path: string): string => `${apiBase}${path}`
