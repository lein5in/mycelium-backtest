import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CalendarDay, CalendarMonth, PnlCalendar as Calendar } from '../../api/result'
import { dayBackground, dayLabel, greenWeeksText, maxAbsDay, runTotals, tintPercent, weekBackground } from './calendarModel'
import { PnlCalendar } from './PnlCalendar'

const session = (date: string, net: number | null, trades: number | null): CalendarDay => ({ date, kind: 'session', net_pnl: net, trades })

function month(): CalendarMonth {
  const week = (monday: string, days: CalendarDay[], net: number, trades: number) => ({ monday, days, net_pnl: net, trades })
  return {
    month: '2024-01',
    weeks: [
      week(
        '2024-01-01',
        [
          { date: '2024-01-01', kind: 'closed', net_pnl: null, trades: null },
          session('2024-01-02', 120, 2),
          session('2024-01-03', -40, 1),
          session('2024-01-04', 0, 0),
          session('2024-01-05', 30, 1),
          { date: '2024-01-06', kind: 'closed', net_pnl: null, trades: null },
          { date: '2024-01-07', kind: 'closed', net_pnl: null, trades: null },
        ],
        110,
        4,
      ),
      week(
        '2024-01-29',
        [
          session('2024-01-29', -60, 1),
          session('2024-01-30', 0, 0),
          session('2024-01-31', 0, 0),
          { date: '2024-02-01', kind: 'other_month', net_pnl: null, trades: null },
          { date: '2024-02-02', kind: 'other_month', net_pnl: null, trades: null },
          { date: '2024-02-03', kind: 'other_month', net_pnl: null, trades: null },
          { date: '2024-02-04', kind: 'other_month', net_pnl: null, trades: null },
        ],
        -60,
        1,
      ),
    ],
    net_pnl: 50,
    trades: 5,
    green_weeks: 1,
    weeks_with_trades: 2,
    best_day: '2024-01-02',
    best_day_pnl: 120,
    worst_day: '2024-01-29',
    worst_day_pnl: -60,
  }
}

const calendar = (): Calendar => ({ rule: 'Each trade counts on its exit session.', timezone: 'America/New_York', months: [month(), { ...month(), month: '2024-02', net_pnl: -20, green_weeks: 0 }] })

describe('calendar model', () => {
  it('tints from 12 to 45 percent by magnitude', () => {
    expect(tintPercent(0, 100)).toBe(12)
    expect(tintPercent(50, 100)).toBe(28.5)
    expect(tintPercent(-500, 100)).toBe(45)
    expect(maxAbsDay([month()])).toBe(120)
    expect(dayBackground(session('2024-01-02', 120, 2), 120)).toBe('color-mix(in srgb, var(--profit) 45%, var(--bg-panel))')
    expect(dayBackground(session('2024-01-03', -40, 1), 120)).toContain('var(--loss) 23%')
    expect(dayBackground(session('2024-01-04', 0, 0), 120)).toBeUndefined()
  })

  it('tints weeks in amber, positive weeks slightly stronger', () => {
    expect(weekBackground(110, 4)).toContain('var(--warn) 16%')
    expect(weekBackground(-60, 1)).toContain('var(--warn) 9%')
    expect(weekBackground(0, 0)).toBeUndefined()
  })

  it('counts green weeks and run totals', () => {
    expect(greenWeeksText(month())).toBe('1 / 2')
    expect(runTotals(calendar().months)).toEqual({ net: 30, trades: 10, green: 1, weeks: 4 })
  })

  it('writes a readable label per day', () => {
    expect(dayLabel(session('2024-01-02', 120, 2))).toBe('Tuesday, 2 January 2024, net +120.00, 2 trades')
    expect(dayLabel(session('2024-01-04', 0, 0))).toBe('Thursday, 4 January 2024, no trades')
    expect(dayLabel({ date: '2024-01-01', kind: 'closed', net_pnl: null, trades: null })).toBe('Monday, 1 January 2024, market closed')
  })
})

describe('P&L calendar', () => {
  it('shows the month with week totals, dashes for no-trade days and the green weeks', () => {
    render(<PnlCalendar calendar={calendar()} selectedDay={null} onSelectDay={() => undefined} />)
    expect(screen.getByText('February 2024')).toBeInTheDocument()
    expect(screen.getByTestId('green-weeks')).toHaveTextContent('0 / 2')
    expect(screen.getByTestId('calendar-total')).toHaveTextContent('−20.00')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('navigates months and switches to the whole run', async () => {
    const user = userEvent.setup()
    render(<PnlCalendar calendar={calendar()} selectedDay={null} onSelectDay={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('January 2024')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-total')).toHaveTextContent('+50.00')
    await user.click(screen.getByRole('button', { name: 'Whole run' }))
    expect(screen.getByTestId('calendar-total')).toHaveTextContent('+30.00')
    expect(screen.getByTestId('green-weeks')).toHaveTextContent('1 / 4')
  })

  it('filters by a day on click or keyboard and clears on a second press', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const { rerender } = render(<PnlCalendar calendar={calendar()} selectedDay={null} onSelectDay={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    const day = screen.getByRole('button', { name: 'Tuesday, 2 January 2024, net +120.00, 2 trades' })
    await user.click(day)
    expect(onSelect).toHaveBeenLastCalledWith('2024-01-02')
    rerender(<PnlCalendar calendar={calendar()} selectedDay="2024-01-02" onSelectDay={onSelect} />)
    const pressed = screen.getByRole('button', { name: 'Tuesday, 2 January 2024, net +120.00, 2 trades' })
    expect(pressed).toHaveAttribute('aria-pressed', 'true')
    pressed.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('button', { name: /Thursday, 4 January/ })).toBeNull()
  })
})
