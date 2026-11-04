import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Truncation } from '../../api/result'
import { tradeRow } from '../../test/resultFixture'
import { TradesTable } from './TradesTable'
import { ALL_TRADES, filterTrades, numberTrades, pageContaining, pageOf, sortTrades, type TradeFilter } from './tradesModel'

const rows = numberTrades(
  [120, -40, 60, -30, 15].map((pnl, index) => tradeRow(index, pnl, index === 3 ? { exit_session: '2024-01-05' } : {})),
  10,
)

const limits = (truncated = false): Truncation => ({
  bars_total: 100,
  bars_returned: 100,
  bars_first_index: 0,
  bars_truncated: false,
  trades_total: truncated ? 5_000 : rows.length,
  trades_returned: rows.length,
  trades_truncated: truncated,
  note: null,
})

describe('trades model', () => {
  it('numbers trades after the truncated ones', () => {
    expect(rows.map((row) => row.number)).toEqual([11, 12, 13, 14, 15])
  })

  it('sorts by any column and keeps a stable order on ties', () => {
    expect(sortTrades(rows, 'net_pnl', 'descending').map((row) => row.net_pnl)).toEqual([120, 60, 15, -30, -40])
    expect(sortTrades(rows, 'side', 'ascending').map((row) => row.number)).toEqual([11, 13, 15, 12, 14])
    expect(sortTrades(rows, 'exit_reason', 'ascending')[0]?.exit_reason).toBe('exit_signal')
  })

  it('filters by side, outcome, exit reason and day', () => {
    expect(filterTrades(rows, { ...ALL_TRADES, side: 'short' })).toHaveLength(2)
    expect(filterTrades(rows, { ...ALL_TRADES, outcome: 'win' })).toHaveLength(3)
    expect(filterTrades(rows, { ...ALL_TRADES, reason: 'exit_signal' })).toHaveLength(1)
    expect(filterTrades(rows, { ...ALL_TRADES, day: '2024-01-05' }).map((row) => row.number)).toEqual([14])
  })

  it('windows thousands of trades into pages', () => {
    const many = Array.from({ length: 2_345 }, (_, index) => index)
    expect(pageOf(many, 0)).toMatchObject({ page: 0, pages: 24, first: 1, last: 100 })
    expect(pageOf(many, 23)).toMatchObject({ first: 2_301, last: 2_345 })
    expect(pageOf(many, 99).page).toBe(23)
    expect(pageOf([], 0)).toMatchObject({ first: 0, last: 0, pages: 1 })
    const numbered = numberTrades(Array.from({ length: 250 }, (_, index) => tradeRow(index, 1)), 0)
    expect(pageContaining(numbered, 230)).toBe(2)
  })
})

function Harness({ onSelect, truncated = false }: { onSelect: (id: number | null) => void; truncated?: boolean }) {
  const [filter, setFilter] = useState<TradeFilter>(ALL_TRADES)
  const [selected, setSelected] = useState<number | null>(null)
  return (
    <TradesTable
      trades={rows}
      limits={limits(truncated)}
      filter={filter}
      onFilterChange={setFilter}
      selected={selected}
      onSelect={(id) => {
        setSelected(id)
        onSelect(id)
      }}
    />
  )
}

describe('trades table', () => {
  it('sorts from the column headers and announces the direction', async () => {
    const user = userEvent.setup()
    render(<Harness onSelect={() => undefined} />)
    const table = screen.getByTestId('trades-table')
    const header = within(table).getByRole('button', { name: /Net/ })
    await user.click(header)
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending')
    const firstNet = within(table).getAllByRole('row')[1]
    expect(firstNet).toHaveTextContent('+120.00')
    await user.click(header)
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('−40.00')
  })

  it('shows profit and loss colours, the exit-signal reason and selects a row by keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    expect(within(screen.getByTestId('trades-table')).getByText('exit signal')).toBeInTheDocument()
    expect(screen.getAllByText('+120.00')[0]).toHaveClass('text-profit-text')
    const row = screen.getAllByRole('row')[1]
    row?.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith(4)
    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('says when the result truncated the trade list', () => {
    render(<Harness onSelect={() => undefined} truncated />)
    expect(screen.getByRole('note')).toHaveTextContent('Showing the last 5 of 5,000 trades')
  })

  it('filters by outcome and shows the visible range', async () => {
    const user = userEvent.setup()
    render(<Harness onSelect={() => undefined} />)
    await user.selectOptions(screen.getByLabelText('Outcome'), 'win')
    expect(screen.getByTestId('trades-range')).toHaveTextContent('1–3 of 3')
  })
})
