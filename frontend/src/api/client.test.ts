import { describe, expect, it } from 'vitest'
import { ApiError, request } from './client'
import { describeError, describeRunFailure, ERROR_COPY, formatWait } from './errorMessages'
import csvOk from './fixtures/csv_preview_ok.json'
import csvProblems from './fixtures/csv_preview_problems.json'
import errorRange from './fixtures/error_range.json'
import health from './fixtures/health.json'
import limits from './fixtures/limits.json'
import markets from './fixtures/markets.json'
import runCreated from './fixtures/run_created.json'
import runStatus from './fixtures/run_status.json'
import strategies from './fixtures/strategies.json'
import {
  csvReportOf,
  fieldProblems,
  isCsvPreview,
  isErrorBody,
  isHealth,
  isLimits,
  isMarkets,
  isRunCreated,
  isRunStatus,
  isStrategies,
} from './guards'

const SERVER_CODES = [
  'invalid_request',
  'not_found',
  'range_too_large',
  'range_invalid',
  'no_data',
  'file_too_large',
  'csv_invalid',
  'symbol_not_supported',
  'market_not_compatible',
  'provider_unavailable',
  'provider_rate_limited',
  'rate_limited',
  'capacity_busy',
  'run_timeout',
  'run_cancelled',
  'run_not_found',
  'run_not_finished',
  'internal_error',
]

describe('response guards accept the real API payloads', () => {
  it.each([
    ['health', isHealth, health],
    ['limits', isLimits, limits],
    ['markets', isMarkets, markets],
    ['strategies', isStrategies, strategies],
    ['run created', isRunCreated, runCreated],
    ['run status', isRunStatus, runStatus],
    ['csv preview ok', isCsvPreview, csvOk],
    ['csv preview problems', isCsvPreview, csvProblems],
    ['error body', isErrorBody, errorRange],
  ] as const)('%s', (_, guard, payload) => {
    expect(guard(payload)).toBe(true)
  })

  it('rejects damaged payloads', () => {
    expect(isLimits({ ...limits, csv_max_bytes: '10' })).toBe(false)
    expect(isMarkets({ ...markets, providers: [{ ...markets.providers[0], mode: 'LIVE' }] })).toBe(false)
    const [first] = strategies.strategies
    expect(isStrategies({ strategies: [{ ...first, parameters: [{ name: 'x' }] }] })).toBe(false)
    expect(isRunStatus({ ...runStatus, status: 'exploded' })).toBe(false)
    expect(isCsvPreview({ ...csvOk, report: null })).toBe(false)
  })

  it('extracts field problems and CSV reports from error details', () => {
    expect(fieldProblems(errorRange.details)).toEqual([{ field: 'data.end', message: errorRange.message }])
    expect(csvReportOf({ csv_report: csvProblems.report })?.problem_count).toBe(csvProblems.report.problem_count)
    expect(csvReportOf(null)).toBeNull()
  })
})

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('request', () => {
  it('returns guarded bodies', async () => {
    const result = await request('/api/health', isHealth, { fetcher: async () => jsonResponse(health) })
    expect(result.version).toBe('0.1.0')
  })

  it('maps error bodies by code, with Retry-After', async () => {
    const error = await request('/api/runs', isRunCreated, {
      fetcher: async () =>
        jsonResponse({ ...errorRange, code: 'capacity_busy', status: 503, message: 'busy' }, 503, { 'Retry-After': '15' }),
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('capacity_busy')
    expect((error as ApiError).retryAfter).toBe(15)
    expect((error as ApiError).requestId).toBe(errorRange.request_id)
  })

  it('flags unreadable answers, network failures, timeouts and aborts', async () => {
    const bad = await request('/api/health', isHealth, { fetcher: async () => jsonResponse({ nope: 1 }) }).catch((e) => e)
    expect(bad.code).toBe('bad_response')
    const down = await request('/api/health', isHealth, {
      fetcher: async () => {
        throw new TypeError('Failed to fetch')
      },
    }).catch((e) => e)
    expect(down.code).toBe('engine_unreachable')
    const proxy = await request('/api/health', isHealth, { fetcher: async () => new Response('', { status: 502 }) }).catch(
      (e) => e,
    )
    expect(proxy.code).toBe('engine_unreachable')
    const hang = (_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort'))))
    const slow = await request('/api/health', isHealth, { fetcher: hang, timeoutMs: 10 }).catch((e) => e)
    expect(slow.code).toBe('request_timeout')
    const controller = new AbortController()
    const pending = request('/api/health', isHealth, { fetcher: hang, signal: controller.signal }).catch((e) => e)
    controller.abort()
    expect((await pending).code).toBe('aborted')
  })
})

describe('error messages', () => {
  it('covers every server code', () => {
    for (const code of SERVER_CODES) expect(ERROR_COPY[code], code).toBeDefined()
  })

  it('uses the wait time from Retry-After for rate limits and capacity', () => {
    const busy = describeError(new ApiError({ code: 'capacity_busy', status: 503, message: 'busy', retryAfter: 15 }))
    expect(busy.action).toBe('Try again in 15 s.')
    const hourly = describeError(new ApiError({ code: 'rate_limited', status: 429, message: 'x', retryAfter: 1800 }))
    expect(hourly.action).toBe('Try again in 30 min.')
    expect(formatWait(61)).toBe('2 min')
  })

  it('keeps the stage and request id and never invents one', () => {
    const failed = describeError(
      new ApiError({ code: 'csv_invalid', status: 422, message: 'The file has 3 problems.', stage: 'DATA', requestId: 'r1' }),
    )
    expect(failed).toMatchObject({ stage: 'DATA', requestId: 'r1', title: 'The CSV file has problems' })
    expect(describeError(new Error('boom')).code).toBe('internal_error')
    expect(describeError(new ApiError({ code: 'brand_new', status: 418, message: 'x' })).title).toBe(
      ERROR_COPY.internal_error?.title,
    )
    expect(describeRunFailure('run_timeout', 'stopped', 'AUDITOR')).toMatchObject({ stage: 'AUDITOR', code: 'run_timeout' })
  })
})
