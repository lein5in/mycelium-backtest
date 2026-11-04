import { useState } from 'react'
import type { CalendarMonth, PnlCalendar as PnlCalendarDocument } from '../../api/result'
import { Button } from '../../ui/Button'
import { signed } from '../report/format'
import { dayBackground, dayLabel, greenWeeksText, maxAbsDay, monthTitle, runTotals, weekBackground } from './calendarModel'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type PnlCalendarProps = {
  calendar: PnlCalendarDocument
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
}

function pnlTone(value: number | null): string {
  if (value === null || value === 0) return 'text-ink'
  return value > 0 ? 'text-profit-text' : 'text-loss-text'
}

export function PnlCalendar({ calendar, selectedDay, onSelectDay }: PnlCalendarProps) {
  const months = calendar.months
  const [mode, setMode] = useState<'month' | 'run'>('month')
  const [index, setIndex] = useState(() => {
    const selected = selectedDay ? months.findIndex((month) => month.month === selectedDay.slice(0, 7)) : -1
    return selected >= 0 ? selected : Math.max(0, months.length - 1)
  })
  if (months.length === 0) {
    return <p className="m-0 px-3 py-3 text-[13px] text-ink-2">No trade closed in this run, so the calendar is empty.</p>
  }
  const maxAbs = maxAbsDay(months)
  const shown = mode === 'month' ? months.slice(index, index + 1) : months
  const current = months[index]
  const totals = runTotals(months)
  const summaryNet = mode === 'month' ? (current?.net_pnl ?? 0) : totals.net
  const summaryGreen = mode === 'month' && current ? greenWeeksText(current) : `${totals.green} / ${totals.weeks}`

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <span role="group" aria-label="Calendar range" className="flex">
          <Button variant="toggle" active={mode === 'month'} onClick={() => setMode('month')} className="min-h-[30px]">
            Month
          </Button>
          <Button variant="toggle" active={mode === 'run'} onClick={() => setMode('run')} className="-ml-px min-h-[30px]">
            Whole run
          </Button>
        </span>
        {mode === 'month' && (
          <span className="flex items-center gap-1">
            <Button className="min-h-[30px] px-2" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} aria-label="Previous month">
              ‹
            </Button>
            <span className="min-w-[128px] text-center text-[13px] font-medium text-ink" aria-live="polite">
              {current ? monthTitle(current.month) : ''}
            </span>
            <Button
              className="min-h-[30px] px-2"
              onClick={() => setIndex((value) => Math.min(months.length - 1, value + 1))}
              disabled={index >= months.length - 1}
              aria-label="Next month"
            >
              ›
            </Button>
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-ink-3">
          <span>
            {mode === 'month' ? 'Month' : 'Run'} total{' '}
            <span className={`tabular-nums ${pnlTone(summaryNet)}`} data-testid="calendar-total">
              {signed(summaryNet)}
            </span>
          </span>
          <span>
            Green weeks <span className="text-ink tabular-nums" data-testid="green-weeks">{summaryGreen}</span>
          </span>
        </span>
      </div>
      {selectedDay && (
        <p className="m-0 flex items-center gap-2 border-b border-line px-3 py-1 text-[12.5px] text-ink-2">
          Trades table filtered to {selectedDay}.
          <button type="button" className="text-accent-text underline" onClick={() => onSelectDay(null)}>
            Clear the day filter
          </button>
        </p>
      )}
      <div className="max-w-full overflow-x-auto">
        {shown.map((month) => (
          <MonthGrid key={month.month} month={month} maxAbs={maxAbs} selectedDay={selectedDay} onSelectDay={onSelectDay} titled={mode === 'run'} />
        ))}
      </div>
      <p className="m-0 border-t border-line px-3 py-1.5 text-[11.5px] text-ink-3">{calendar.rule}</p>
    </div>
  )
}

function MonthGrid({
  month,
  maxAbs,
  selectedDay,
  onSelectDay,
  titled,
}: {
  month: CalendarMonth
  maxAbs: number
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
  titled: boolean
}) {
  return (
    <table className="w-full min-w-[640px] table-fixed border-collapse">
      <caption className={titled ? 'label-caps px-3 py-1.5 text-left text-ink-3' : 'sr-only-text'}>
        {monthTitle(month.month)} · {signed(month.net_pnl)} · green weeks {greenWeeksText(month)}
      </caption>
      <thead>
        <tr className="bg-panel-head">
          {[...WEEKDAYS, 'Week'].map((name) => (
            <th key={name} scope="col" className="label-caps border-b border-line-strong px-2 py-1 text-left font-medium text-ink-3">
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {month.weeks.map((week) => (
          <tr key={week.monday}>
            {week.days.map((day) => {
              if (day.kind === 'other_month') return <td key={day.date} className="h-16 border border-line bg-app" aria-hidden="true" />
              const number = Number(day.date.slice(8, 10))
              const traded = day.kind === 'session' && Boolean(day.trades)
              const selected = selectedDay === day.date
              const background = dayBackground(day, maxAbs)
              const content = (
                <>
                  <span className="font-mono text-[11px] text-ink-3">{number}</span>
                  <span className={`font-mono text-[12.5px] tabular-nums ${traded ? pnlTone(day.net_pnl) : 'text-ink-3'}`}>
                    {traded ? signed(day.net_pnl ?? 0) : day.kind === 'closed' ? 'closed' : day.kind === 'no_data' ? 'no data' : '—'}
                  </span>
                </>
              )
              return (
                <td key={day.date} className="h-16 border border-line p-0 align-top" style={background ? { background } : { background: 'var(--bg-panel)' }}>
                  {traded ? (
                    <button
                      type="button"
                      aria-label={dayLabel(day)}
                      aria-pressed={selected}
                      onClick={() => onSelectDay(selected ? null : day.date)}
                      className={`flex h-full min-h-16 w-full flex-col justify-between px-2 py-1.5 text-left hover:brightness-125 ${selected ? 'outline-2 -outline-offset-2 outline-accent' : ''}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <span aria-label={dayLabel(day)} role="img" className="flex h-full min-h-16 flex-col justify-between px-2 py-1.5">
                      {content}
                    </span>
                  )}
                </td>
              )
            })}
            <td
              className="h-16 border border-line px-2 py-1.5 align-top"
              style={{ background: weekBackground(week.net_pnl, week.trades) ?? 'var(--bg-panel)' }}
              aria-label={`Week of ${week.monday}: ${week.trades ? `${signed(week.net_pnl)}, ${week.trades} trades` : 'no trades'}`}
            >
              <span className="flex h-full flex-col justify-between">
                <span className="font-mono text-[11px] text-warn-text/80">{week.trades ? `${week.trades} tr` : ''}</span>
                <span className={`font-mono text-[12.5px] tabular-nums ${week.trades ? 'text-warn-text' : 'text-ink-3'}`}>
                  {week.trades ? signed(week.net_pnl) : '—'}
                </span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
