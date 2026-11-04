import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { getRunResult } from '../api/client'
import { describeError, type DescribedError } from '../api/errorMessages'
import type { RunResultPayload } from '../api/result'
import { PnlCalendar } from '../features/calendar/PnlCalendar'
import { HeatmapChart } from '../features/chart/HeatmapChart'
import { chartDataFromResult } from '../features/chart/fromResult'
import { ReplayControls } from '../features/chart/ReplayControls'
import { history, type HistoryEntry } from '../features/history/historyStore'
import { AssumptionsList, HonestyReportPanel } from '../features/report/HonestyReportPanel'
import { KpiStrip } from '../features/report/KpiStrip'
import { RandomHistogram } from '../features/report/RandomHistogram'
import { SweepHeatmap } from '../features/report/SweepHeatmap'
import { RESULT_TABS, tabFromSearch, type ResultTab } from '../features/report/resultTabs'
import { TradesTable } from '../features/trades/TradesTable'
import { ALL_TRADES, numberTrades, type TradeFilter } from '../features/trades/tradesModel'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { ErrorPanel, SkeletonRows } from '../ui/States'
import { ModeBadge, Tag } from '../ui/Tag'

const TAB_LABELS: Record<ResultTab, string> = {
  report: 'Report',
  chart: 'Chart',
  trades: 'Trades',
  calendar: 'Calendar',
  sweep: 'Sweep',
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; payload: RunResultPayload; fromHistory: boolean }
  | { status: 'missing'; error: DescribedError; entry: HistoryEntry | null }

export function ResultsPage() {
  const { id = '' } = useParams()
  return <Results key={id} id={id} />
}

function Results({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const navigate = useNavigate()

  useEffect(() => {
    const controller = new AbortController()
    getRunResult(id, { signal: controller.signal })
      .then((payload) => setLoad({ status: 'ready', payload, fromHistory: false }))
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        const described = describeError(error)
        const stored = await history.loadResult(id).catch(() => null)
        if (stored) {
          setLoad({ status: 'ready', payload: stored, fromHistory: true })
          return
        }
        const entry = await history.get(id).catch(() => undefined)
        setLoad({ status: 'missing', error: described, entry: entry ?? null })
      })
    return () => controller.abort()
  }, [id])

  if (load.status === 'loading') {
    return (
      <div className="flex flex-col gap-px p-3">
        <h1 className="sr-only-text">Results</h1>
        <Panel label="Results">
          <SkeletonRows rows={6} label="Loading the result" />
        </Panel>
      </div>
    )
  }
  if (load.status === 'missing') {
    const expired = load.error.code === 'run_not_found' || load.error.code === 'not_found'
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-4 py-10">
        <h1 className="m-0 text-[22px] font-semibold text-ink">{expired ? 'This result has expired' : 'The result could not be loaded'}</h1>
        <ErrorPanel
          error={
            expired
              ? {
                  ...load.error,
                  title: 'The server no longer has this run',
                  message: 'Results stay on the server for about 30 minutes, and this browser did not keep a full copy.',
                  action: load.entry ? 'Run it again with the same settings.' : 'Start a new run.',
                }
              : load.error
          }
          action={
            <span className="flex flex-wrap gap-2">
              {load.entry && (
                <Button variant="primary" onClick={() => navigate('/app', { state: { request: load.entry?.request } })}>
                  Run again
                </Button>
              )}
              <Link className="inline-flex min-h-[34px] items-center border border-line-strong px-3 font-mono text-xs tracking-[0.06em] text-ink uppercase hover:bg-hover" to="/app/history">
                History
              </Link>
            </span>
          }
        />
      </div>
    )
  }
  return <Workbench payload={load.payload} fromHistory={load.fromHistory} />
}

function Workbench({ payload, fromHistory }: { payload: RunResultPayload; fromHistory: boolean }) {
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const tab = tabFromSearch(search.get('tab'))
  const day = search.get('day')
  const tradeParam = search.get('trade')
  const selectedTrade = tradeParam === null || Number.isNaN(Number(tradeParam)) ? null : Number(tradeParam)
  const [filter, setFilter] = useState<TradeFilter>(ALL_TRADES)
  const [showTrades, setShowTrades] = useState(true)
  const [cursor, setCursor] = useState<number | null>(null)
  const first = useRef(true)

  const chartData = useMemo(() => chartDataFromResult(payload), [payload])
  const trades = useMemo(
    () => numberTrades(payload.result.trades, payload.limits.trades_total - payload.limits.trades_returned),
    [payload],
  )
  const activeFilter = useMemo(() => ({ ...filter, day }), [filter, day])

  const update = useCallback(
    (change: Record<string, string | null>) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(change)) {
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearch],
  )

  const focusSection = useCallback((target: ResultTab) => {
    const element = document.getElementById(`results-${target}`)
    if (!element) return
    element.scrollIntoView({ block: 'start', behavior: 'auto' })
    element.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (first.current) {
      first.current = false
      if (search.get('tab')) focusSection(tab)
    }
  }, [focusSection, search, tab])

  const selectTab = (target: ResultTab) => {
    update({ tab: target })
    focusSection(target)
  }

  const source = payload.source
  const request = payload.request
  const period = `${payload.result.first_bar.slice(0, 10)} → ${payload.result.last_bar.slice(0, 10)}`
  const passPercentile = typeof payload.report.config.random_pass_percentile === 'number' ? payload.report.config.random_pass_percentile : null

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <h1 className="sr-only-text">
        Results · {payload.result.strategy} · {source.symbol}
      </h1>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel-head px-3">
        <div role="tablist" aria-label="Results sections" className="flex flex-wrap">
          {RESULT_TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              aria-controls={`results-${item}`}
              onClick={() => selectTab(item)}
              className={`label-caps -mb-px inline-flex min-h-[40px] items-center border-b-2 px-3 ${tab === item ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'}`}
            >
              {TAB_LABELS[item]}
            </button>
          ))}
        </div>
        <span className="ml-auto flex flex-wrap items-center gap-2 py-1">
          <Button variant="primary" onClick={() => navigate('/app', { state: { request } })}>
            Run again
          </Button>
          <button
            type="button"
            disabled
            aria-label="Share, available soon"
            className="inline-flex min-h-[34px] cursor-not-allowed items-center gap-2 border border-line-strong px-3 font-mono text-xs tracking-[0.06em] text-ink-3 uppercase opacity-70"
          >
            Share
            <Tag state="SOON" />
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel px-3 py-1.5">
        <span className="text-[14px] font-medium text-ink">{payload.result.strategy}</span>
        <span className="font-mono text-[12px] text-ink-2">
          {source.symbol} · {source.timeframe ?? ''} · {period} · {payload.result.bar_count.toLocaleString('en-US')} bars
        </span>
        <ModeBadge mode={source.mode} />
        <ModeBadge mode={payload.heatmap.mode === 'FROM_TRADES' ? 'FROM TRADES' : 'ESTIMATED FROM CANDLES'} />
        <span className="font-mono text-[11.5px] text-ink-3">{source.display_name}</span>
        {fromHistory && (
          <span className="font-mono text-[11.5px] text-warn-text">Opened from this browser's history; the server has purged this run.</span>
        )}
      </div>
      <KpiStrip payload={payload} />

      <div className="grid min-w-0 bg-app xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <section
          id="results-chart"
         
          tabIndex={-1}
          aria-labelledby="chart-heading"
          className="flex min-w-0 flex-col bg-panel outline-none xl:sticky xl:top-0"
        >
          <header className="flex min-h-[40px] flex-wrap items-center gap-2 border-b border-line bg-panel-head px-3 py-1">
            <h2 id="chart-heading" className="label-caps m-0 font-medium text-ink-3">
              Chart · equity · drawdown
            </h2>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="toggle" active={showTrades} onClick={() => setShowTrades((value) => !value)}>
                Trade markers
              </Button>
              <ReplayControls candles={chartData.candles} cursor={cursor} onCursor={setCursor} />
            </span>
          </header>
          {payload.limits.bars_truncated && payload.limits.note && (
            <p className="m-0 border-b border-line px-3 py-1 text-[12px] text-warn-text">{payload.limits.note}</p>
          )}
          <div className="relative h-[min(720px,calc(100dvh-140px))] min-h-[480px]">
            <HeatmapChart
              data={chartData}
              sourceMode={source.mode}
              showTrades={showTrades}
              showPanes
              cursor={cursor}
              selectedTrade={selectedTrade}
              label={`Price chart of ${source.symbol} with the volume heatmap, ${trades.length} trade markers, equity and drawdown panes`}
            />
          </div>
          {cursor !== null && (
            <p className="m-0 border-t border-line px-3 py-1 text-[12px] text-ink-3">
              Replay shows the finished run's chart up to the cursor only: later prices, heatmap columns, trades and equity stay hidden.
              The volume profile covers the whole run, so it is hidden during the replay.
            </p>
          )}
        </section>

        <aside aria-label="Honesty" className="flex min-w-0 flex-col gap-px border-l border-line bg-line">
          <section id="results-report" tabIndex={-1} aria-labelledby="report-heading" className="bg-panel outline-none">
            <h2 id="report-heading" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
              Honesty report
            </h2>
            <HonestyReportPanel report={payload.report} />
          </section>
          <section aria-labelledby="random-heading" className="bg-panel">
            <h2 id="random-heading" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
              Versus random entries
            </h2>
            <RandomHistogram random={payload.report.random_entries} passPercentile={passPercentile} />
          </section>
          <section id="results-sweep" tabIndex={-1} aria-labelledby="sweep-heading" className="bg-panel outline-none">
            <h2 id="sweep-heading" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
              Parameter sweep
            </h2>
            <SweepHeatmap report={payload.report} />
          </section>
          <section aria-labelledby="assumptions-heading" className="flex-1 bg-panel">
            <h2 id="assumptions-heading" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
              Assumptions and limits
            </h2>
            <AssumptionsList items={[...payload.report.assumptions, ...payload.result.assumptions, ...payload.data_warnings]} />
            <p className="m-0 border-t border-line px-3 py-1.5 text-[11.5px] text-ink-3">{source.attribution}</p>
          </section>
        </aside>
      </div>

      <div className="grid min-w-0 gap-px border-t border-line bg-line 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section id="results-calendar" tabIndex={-1} aria-labelledby="calendar-heading" className="min-w-0 bg-panel outline-none">
          <h2 id="calendar-heading" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
            P&amp;L calendar · {payload.report.calendar.timezone}
          </h2>
          <PnlCalendar
            calendar={payload.report.calendar}
            selectedDay={day}
            onSelectDay={(value) => {
              update({ day: value })
              if (value) focusSection('trades')
            }}
          />
        </section>
        <section id="results-trades" tabIndex={-1} aria-labelledby="trades-heading" className="min-w-0 bg-panel outline-none">
          <h2 id="trades-heading" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
            Trades
          </h2>
          <TradesTable
            trades={trades}
            limits={payload.limits}
            filter={activeFilter}
            onFilterChange={(next) => {
              setFilter({ ...next, day: null })
              if (next.day !== day) update({ day: next.day })
            }}
            selected={selectedTrade}
            onSelect={(value) => {
              update({ trade: value === null ? null : String(value) })
              if (value !== null) focusSection('chart')
            }}
          />
        </section>
      </div>
    </div>
  )
}
