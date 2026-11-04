import { ApiError } from './client'

export type ErrorCopy = { title: string; action: string }

export const ERROR_COPY: Record<string, ErrorCopy> = {
  invalid_request: {
    title: 'Some settings are not valid',
    action: 'Correct the fields marked below, then launch again.',
  },
  not_found: { title: 'Not found', action: 'Check the address, or go back to a new run.' },
  range_too_large: {
    title: 'The date range is too long',
    action: 'Shorten the range to the limit shown for this timeframe.',
  },
  range_invalid: {
    title: 'The date range cannot be used',
    action: 'Pick a start before the end, inside the period this source covers.',
  },
  no_data: { title: 'No data in this range', action: 'Pick another period or another symbol.' },
  file_too_large: {
    title: 'The file is too large',
    action: 'Split the file or shorten its period so it fits under the size limit.',
  },
  csv_invalid: {
    title: 'The CSV file has problems',
    action: 'Fix the rows and columns listed in the report, then upload the file again.',
  },
  symbol_not_supported: { title: 'Symbol not offered', action: 'Choose one of the listed symbols.' },
  market_not_compatible: {
    title: 'Strategy and market do not match',
    action: 'Pick a strategy that supports this market, or change the market.',
  },
  provider_unavailable: {
    title: 'The data source is unavailable',
    action: 'Try again in a few minutes, or use another source.',
  },
  provider_rate_limited: {
    title: 'The data source asked us to slow down',
    action: 'Wait a little, then launch again.',
  },
  rate_limited: { title: 'Too many requests', action: 'Wait before trying again.' },
  capacity_busy: {
    title: 'The engine is busy with other runs',
    action: 'Wait a moment, then launch again.',
  },
  run_timeout: {
    title: 'The run took too long and was stopped',
    action: 'Use a shorter range, fewer random draws, or switch the parameter sweep off.',
  },
  run_cancelled: { title: 'The run was cancelled', action: 'Start a new run when you are ready.' },
  run_not_found: {
    title: 'This run is not available',
    action: 'Runs are kept for a short time only. Start a new run.',
  },
  run_not_finished: { title: 'The run is still in progress', action: 'Wait for it to finish.' },
  internal_error: {
    title: 'The engine hit an unexpected error',
    action: 'Try again. If it happens again, report it with the request id.',
  },
  engine_unreachable: {
    title: 'The engine is unreachable',
    action: 'Check your connection. The page checks again automatically.',
  },
  request_timeout: { title: 'The engine did not answer in time', action: 'Try again in a moment.' },
  bad_response: {
    title: 'The engine sent an answer this page cannot read',
    action: 'Reload the page. If it happens again, report it with the request id.',
  },
  aborted: { title: 'Request cancelled', action: 'Start it again when you are ready.' },
}

const FALLBACK: ErrorCopy = ERROR_COPY.internal_error as ErrorCopy

export type DescribedError = {
  code: string
  title: string
  message: string
  action: string
  stage: string | null
  requestId: string | null
  retryAfter: number | null
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} min`
}

export function describeError(error: unknown): DescribedError {
  const api =
    error instanceof ApiError
      ? error
      : new ApiError({ code: 'internal_error', status: 0, message: 'Something went wrong in this page.' })
  const copy = ERROR_COPY[api.code] ?? FALLBACK
  const action =
    api.retryAfter !== null && (api.code === 'rate_limited' || api.code === 'capacity_busy' || api.code === 'provider_rate_limited')
      ? `Try again in ${formatWait(api.retryAfter)}.`
      : copy.action
  return {
    code: api.code,
    title: copy.title,
    message: api.message,
    action,
    stage: api.stage,
    requestId: api.requestId,
    retryAfter: api.retryAfter,
  }
}

export function describeRunFailure(code: string | null | undefined, message: string, stage: string | null): DescribedError {
  const key = code ?? 'internal_error'
  const copy = ERROR_COPY[key] ?? FALLBACK
  return { code: key, title: copy.title, message, action: copy.action, stage, requestId: null, retryAfter: null }
}
