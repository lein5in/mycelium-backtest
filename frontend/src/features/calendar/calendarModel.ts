import type { CalendarDay, CalendarMonth } from '../../api/result'
import { signed } from '../report/format'

export const MIN_TINT = 12
export const MAX_TINT = 45

export function tintPercent(value: number, maxAbs: number): number {
  if (maxAbs <= 0) return MIN_TINT
  return MIN_TINT + (MAX_TINT - MIN_TINT) * Math.min(1, Math.abs(value) / maxAbs)
}

export function dayBackground(day: CalendarDay, maxAbs: number): string | undefined {
  if (day.kind !== 'session' || !day.trades || day.net_pnl === null || day.net_pnl === 0) return undefined
  const colour = day.net_pnl > 0 ? 'var(--profit)' : 'var(--loss)'
  return `color-mix(in srgb, ${colour} ${tintPercent(day.net_pnl, maxAbs).toFixed(0)}%, var(--bg-panel))`
}

export function weekBackground(netPnl: number, trades: number): string | undefined {
  if (trades === 0) return undefined
  return `color-mix(in srgb, var(--warn) ${netPnl > 0 ? 16 : 9}%, var(--bg-panel))`
}

export function maxAbsDay(months: readonly CalendarMonth[]): number {
  let max = 0
  for (const month of months) {
    for (const week of month.weeks) {
      for (const day of week.days) {
        if (day.kind === 'session' && day.net_pnl !== null && day.trades) max = Math.max(max, Math.abs(day.net_pnl))
      }
    }
  }
  return max
}

export function greenWeeksText(month: CalendarMonth): string {
  return `${month.green_weeks} / ${month.weeks_with_trades}`
}

const LONG_DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function dayLabel(day: CalendarDay): string {
  const date = LONG_DATE.format(new Date(`${day.date}T00:00:00Z`))
  if (day.kind === 'closed') return `${date}, market closed`
  if (day.kind === 'no_data') return `${date}, no data`
  if (!day.trades) return `${date}, no trades`
  const trades = `${day.trades} trade${day.trades === 1 ? '' : 's'}`
  return `${date}, net ${signed(day.net_pnl ?? 0)}, ${trades}`
}

export function monthTitle(month: string): string {
  const [year, number] = month.split('-')
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(year), Number(number) - 1, 1)),
  )
}

export function runTotals(months: readonly CalendarMonth[]): { net: number; trades: number; green: number; weeks: number } {
  return months.reduce(
    (total, month) => ({
      net: total.net + month.net_pnl,
      trades: total.trades + month.trades,
      green: total.green + month.green_weeks,
      weeks: total.weeks + month.weeks_with_trades,
    }),
    { net: 0, trades: 0, green: 0, weeks: 0 },
  )
}
