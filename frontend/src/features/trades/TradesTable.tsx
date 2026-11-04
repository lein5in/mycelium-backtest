import { useMemo, useState, type KeyboardEvent } from 'react'
import { EXIT_REASONS, type Truncation } from '../../api/result'
import { Button } from '../../ui/Button'
import { dateTime, money, plain } from '../report/format'
import {
  EXIT_REASON_LABELS,
  filterTrades,
  pageContaining,
  pageOf,
  sortTrades,
  type NumberedTrade,
  type SortDirection,
  type SortKey,
  type TradeFilter,
} from './tradesModel'

type Column = { key: SortKey; header: string; numeric: boolean; render: (trade: NumberedTrade) => string }

const COLUMNS: Column[] = [
  { key: 'number', header: '#', numeric: true, render: (trade) => String(trade.number) },
  { key: 'side', header: 'Side', numeric: false, render: (trade) => trade.side },
  { key: 'entry_time', header: 'Entry time', numeric: false, render: (trade) => dateTime(trade.entry_time) },
  { key: 'entry_price', header: 'Entry', numeric: true, render: (trade) => plain(trade.entry_price, 4) },
  { key: 'exit_time', header: 'Exit time', numeric: false, render: (trade) => dateTime(trade.exit_time) },
  { key: 'exit_price', header: 'Exit', numeric: true, render: (trade) => plain(trade.exit_price, 4) },
  { key: 'quantity', header: 'Qty', numeric: true, render: (trade) => plain(trade.quantity, 4) },
  { key: 'exit_reason', header: 'Exit reason', numeric: false, render: (trade) => EXIT_REASON_LABELS[trade.exit_reason] },
  { key: 'gross_pnl', header: 'Gross', numeric: true, render: (trade) => money(trade.gross_pnl) },
  { key: 'fees', header: 'Fees', numeric: true, render: (trade) => plain(trade.fees) },
  { key: 'slippage_cost', header: 'Slippage', numeric: true, render: (trade) => plain(trade.slippage_cost) },
  { key: 'net_pnl', header: 'Net', numeric: true, render: (trade) => money(trade.net_pnl) },
  { key: 'bars_held', header: 'Bars', numeric: true, render: (trade) => String(trade.bars_held) },
]

const pnlClass = (value: number) => (value > 0 ? 'text-profit-text' : value < 0 ? 'text-loss-text' : 'text-ink')

type TradesTableProps = {
  trades: NumberedTrade[]
  limits: Truncation
  filter: TradeFilter
  onFilterChange: (filter: TradeFilter) => void
  selected: number | null
  onSelect: (id: number | null) => void
}

export function TradesTable({ trades, limits, filter, onFilterChange, selected, onSelect }: TradesTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'number', direction: 'descending' })
  const [page, setPage] = useState(0)
  const rows = useMemo(() => sortTrades(filterTrades(trades, filter), sort.key, sort.direction), [trades, filter, sort])
  const [lastSelected, setLastSelected] = useState(selected)
  if (selected !== lastSelected) {
    setLastSelected(selected)
    if (selected !== null) {
      const target = pageContaining(rows, selected)
      if (target !== null) setPage(target)
    }
  }
  const current = pageOf(rows, page)

  const toggleSort = (key: SortKey) => {
    setSort((value) => ({ key, direction: value.key === key && value.direction === 'descending' ? 'ascending' : 'descending' }))
    setPage(0)
  }
  const change = (next: Partial<TradeFilter>) => {
    onFilterChange({ ...filter, ...next })
    setPage(0)
  }
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, trade: NumberedTrade) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(selected === trade.id ? null : trade.id)
  }

  return (
    <div className="flex min-w-0 flex-col">
      {limits.trades_truncated && (
        <p role="note" className="m-0 border-b border-line bg-panel-head px-3 py-1.5 text-[12.5px] text-warn-text">
          Showing the last {limits.trades_returned.toLocaleString('en-US')} of {limits.trades_total.toLocaleString('en-US')} trades. Totals,
          the report and the calendar use every trade.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px]">
        <label className="flex items-center gap-1.5 text-ink-2">
          Side
          <select
            className="h-[30px] border border-line-strong bg-app px-1.5 font-mono text-[12px] text-ink"
            value={filter.side}
            onChange={(event) => change({ side: event.target.value as TradeFilter['side'] })}
          >
            <option value="all">all</option>
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-ink-2">
          Outcome
          <select
            className="h-[30px] border border-line-strong bg-app px-1.5 font-mono text-[12px] text-ink"
            value={filter.outcome}
            onChange={(event) => change({ outcome: event.target.value as TradeFilter['outcome'] })}
          >
            <option value="all">all</option>
            <option value="win">wins</option>
            <option value="loss">losses and flat</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-ink-2">
          Exit reason
          <select
            className="h-[30px] border border-line-strong bg-app px-1.5 font-mono text-[12px] text-ink"
            value={filter.reason}
            onChange={(event) => change({ reason: event.target.value as TradeFilter['reason'] })}
          >
            <option value="all">all</option>
            {EXIT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {EXIT_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
        </label>
        {filter.day && (
          <span className="flex items-center gap-1.5 border border-accent px-2 py-0.5 font-mono text-[11.5px] text-accent-text">
            day {filter.day}
            <button type="button" className="text-ink underline" onClick={() => change({ day: null })} aria-label={`Clear the filter on ${filter.day}`}>
              clear
            </button>
          </span>
        )}
        <span className="ml-auto font-mono text-[11.5px] text-ink-3" aria-live="polite" data-testid="trades-range">
          {rows.length === 0 ? '0 trades' : `${current.first.toLocaleString('en-US')}–${current.last.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')}`}
        </span>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]" data-testid="trades-table">
          <caption className="sr-only-text">Trades. Select a row to show the trade on the chart.</caption>
          <thead>
            <tr className="bg-panel-head">
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sort.key === column.key ? sort.direction : 'none'}
                  className={`border-b border-line-strong p-0 font-medium ${column.numeric ? 'text-right' : 'text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className={`label-caps w-full px-3 py-1.5 whitespace-nowrap hover:text-ink-2 ${column.numeric ? 'text-right' : 'text-left'} ${sort.key === column.key ? 'text-ink' : 'text-ink-3'}`}
                  >
                    {column.header}
                    {sort.key === column.key ? (sort.direction === 'ascending' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {current.rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-3 text-ink-3">
                  No trade matches these filters.
                </td>
              </tr>
            )}
            {current.rows.map((trade) => {
              const isSelected = trade.id === selected
              return (
                <tr
                  key={trade.id}
                  tabIndex={0}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onSelect(isSelected ? null : trade.id)}
                  onKeyDown={(event) => onRowKey(event, trade)}
                  className={`cursor-pointer border-b border-line hover:bg-hover ${isSelected ? 'bg-hover shadow-[inset_2px_0_0_var(--accent)]' : ''}`}
                >
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-1 whitespace-nowrap ${column.numeric ? 'text-right font-mono tabular-nums' : 'text-ink-2'} ${column.key === 'net_pnl' || column.key === 'gross_pnl' ? pnlClass(trade[column.key]) : column.numeric ? 'text-ink' : ''} ${column.key.endsWith('_time') ? 'font-mono text-[12px]' : ''}`}
                    >
                      {column.render(trade)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {current.pages > 1 && (
        <nav aria-label="Trade pages" className="flex items-center gap-2 border-t border-line px-3 py-1.5">
          <Button className="min-h-[30px]" onClick={() => setPage(current.page - 1)} disabled={current.page === 0}>
            Previous
          </Button>
          <span className="font-mono text-[12px] text-ink-3">
            page {current.page + 1} / {current.pages}
          </span>
          <Button className="min-h-[30px]" onClick={() => setPage(current.page + 1)} disabled={current.page >= current.pages - 1}>
            Next
          </Button>
        </nav>
      )}
    </div>
  )
}
