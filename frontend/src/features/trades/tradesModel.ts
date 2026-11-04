import type { ExitReason, Side, TradeRow } from '../../api/result'

export type NumberedTrade = TradeRow & { number: number; id: number }

export type SortKey =
  | 'number'
  | 'side'
  | 'entry_time'
  | 'exit_time'
  | 'entry_price'
  | 'exit_price'
  | 'quantity'
  | 'exit_reason'
  | 'gross_pnl'
  | 'fees'
  | 'slippage_cost'
  | 'net_pnl'
  | 'bars_held'

export type SortDirection = 'ascending' | 'descending'

export type TradeFilter = {
  side: Side | 'all'
  outcome: 'all' | 'win' | 'loss'
  reason: ExitReason | 'all'
  day: string | null
}

export const ALL_TRADES: TradeFilter = { side: 'all', outcome: 'all', reason: 'all', day: null }

export const PAGE_SIZE = 100

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  stop: 'stop',
  target: 'target',
  time_exit: 'time exit',
  exit_signal: 'exit signal',
  risk_limit: 'risk limit',
  end_of_data: 'end of data',
}

export function numberTrades(trades: readonly TradeRow[], offset: number): NumberedTrade[] {
  return trades.map((trade, index) => ({ ...trade, id: index, number: offset + index + 1 }))
}

export function filterTrades(trades: readonly NumberedTrade[], filter: TradeFilter): NumberedTrade[] {
  return trades.filter(
    (trade) =>
      (filter.side === 'all' || trade.side === filter.side) &&
      (filter.reason === 'all' || trade.exit_reason === filter.reason) &&
      (filter.outcome === 'all' || (filter.outcome === 'win' ? trade.net_pnl > 0 : trade.net_pnl <= 0)) &&
      (filter.day === null || trade.exit_session === filter.day),
  )
}

export function sortTrades(trades: readonly NumberedTrade[], key: SortKey, direction: SortDirection): NumberedTrade[] {
  const sign = direction === 'ascending' ? 1 : -1
  return [...trades].sort((a, b) => {
    const left = a[key]
    const right = b[key]
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))
    return order === 0 ? a.number - b.number : sign * order
  })
}

export function pageOf<T>(rows: readonly T[], page: number, size = PAGE_SIZE): { rows: T[]; page: number; pages: number; first: number; last: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(Math.max(0, page), pages - 1)
  const first = current * size
  const slice = rows.slice(first, first + size)
  return { rows: slice, page: current, pages, first: rows.length === 0 ? 0 : first + 1, last: first + slice.length }
}

export function pageContaining(rows: readonly NumberedTrade[], id: number, size = PAGE_SIZE): number | null {
  const index = rows.findIndex((row) => row.id === id)
  return index < 0 ? null : Math.floor(index / size)
}
