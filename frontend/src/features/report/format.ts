import type { CheckId, Verdict } from '../../api/runEvents'

export const VERDICT_LABELS: Record<Verdict, string> = {
  CREDIBLE: 'CREDIBLE',
  FRAGILE: 'FRAGILE',
  NOT_CREDIBLE: 'NOT CREDIBLE',
}

export const VERDICT_CLASSES: Record<Verdict, string> = {
  CREDIBLE: 'border-profit text-profit-text',
  FRAGILE: 'border-warn text-warn-text',
  NOT_CREDIBLE: 'border-loss text-loss-text',
}

export const CHECK_LABELS: Record<CheckId, string> = {
  costs: 'Costs on every fill',
  trade_count: 'Enough trades',
  without_best_trade: 'Without the best trade',
  out_of_sample: 'Out-of-sample (last 30%)',
  versus_random: 'Versus random entries',
  robustness: 'Robustness',
}

export function isVerdict(value: unknown): value is Verdict {
  return value === 'CREDIBLE' || value === 'FRAGILE' || value === 'NOT_CREDIBLE'
}

const MINUS = '−'

export function signed(value: number, digits = 2): string {
  const text = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (value > 0) return `+${text}`
  if (value < 0) return `${MINUS}${text}`
  return text
}

export function money(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return signed(value, digits)
}

export function plain(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function profitFactor(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a'
  return value.toFixed(2)
}

export function toneOf(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0 || !Number.isFinite(value)) return 'text-ink'
  return value > 0 ? 'text-profit-text' : 'text-loss-text'
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('en-US')
}

export function dateTime(iso: string): string {
  return iso.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, ' UTC').replace(/Z$/, ' UTC')
}
