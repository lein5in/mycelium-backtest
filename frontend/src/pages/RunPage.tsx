import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { cancelRun, getRunResult, getRunStatus } from '../api/client'
import { describeError, describeRunFailure, type DescribedError } from '../api/errorMessages'
import type { RunRequestDocument, RunResultPayload } from '../api/result'
import { CHECK_IDS, STAGES, type RunEvent, type Stage } from '../api/runEvents'
import type { RunStatusDocument, StrategyMetadata } from '../api/types'
import { useCatalog } from '../app/useCatalog'
import { HeatmapChart, type ChartProjection } from '../features/chart/HeatmapChart'
import { chartDataFromResult } from '../features/chart/fromResult'
import { Crawler, type CrawlerDebug } from '../features/crawler/Crawler'
import { applyDisplayItem, DISPLAY_SPEEDS, type DisplayItem, type DisplaySpeed, type StepInfo } from '../features/crawler/playback'
import type { CrawlerHandle, CrawlerLayout, WrapRegion } from '../features/crawler/types'
import { entryFromRequest, history, HistoryError } from '../features/history/historyStore'
import { CHECK_LABELS, money, VERDICT_CLASSES, VERDICT_LABELS } from '../features/report/format'
import { deriveCounters, type Counter } from '../features/run/counters'
import { chartLayout, dataRange, linearLayout, regionInPrices, type StageRefs } from '../features/run/layouts'
import { RequestDock } from '../features/run/RequestDock'
import { useRunPlayback } from '../features/run/useRunPlayback'
import { useRunStream } from '../features/run/useRunStream'
import { activeStageIndex, describeEvent, initialRunView, overallPercent, reduceRunView, type CellState } from '../features/run/runView'
import { Button } from '../ui/Button'
import { ErrorPanel, LoadingLine } from '../ui/States'
import { Tag, type TagState } from '../ui/Tag'

const CELL_TAG: Record<CellState, TagState> = { WAIT: 'WAIT', RUN: 'RUN', DONE: 'DONE', FAIL: 'FAIL' }
const PROGRESS_CLASSES: Record<CellState, string> = { WAIT: 'bg-line-strong', RUN: 'bg-accent', DONE: 'bg-violet', FAIL: 'bg-loss' }
const GATE_MS = 1500
const LOG_LIMIT = 500
const BOTTOM_TABS = ['log', 'trades', 'errors', 'counters'] as const
type BottomTab = (typeof BOTTOM_TABS)[number]

type ResultLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; payload: RunResultPayload }
  | { status: 'error'; error: DescribedError }

type LocationState = { request?: RunRequestDocument } | null

declare global {
  interface Window {
    __runCrawler?: CrawlerDebug
    __runPlayback?: { steps: { shownAt: number; hold: number; kind: string; members: number }[] }
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function RunPage() {
  const { id = '' } = useParams()
  return <RunScreen key={id} id={id} />
}

function RunScreen({ id }: { id: string }) {
  const location = useLocation()
  const catalog = useCatalog()
  const stream = useRunStream(id)
  const [status, setStatus] = useState<RunStatusDocument | null>(null)
  const [statusError, setStatusError] = useState<DescribedError | null>(null)
  const [result, setResult] = useState<ResultLoad>({ status: 'idle' })
  const [request, setRequest] = useState<RunRequestDocument | null>(() => (location.state as LocationState)?.request ?? null)
  const [historyNote, setHistoryNote] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<DescribedError | null>(null)
  const [tab, setTab] = useState<BottomTab>('log')
  const [reducedMotion] = useState(prefersReducedMotion)
  const [projection, setProjection] = useState<ChartProjection | null>(null)
  const [gateTimerDone, setGateTimerDone] = useState(false)
  const [now, setNow] = useState(() => performance.now())

  const crawlerRef = useRef<CrawlerHandle>(null)

  const arrived = stream.events
  const firstArrival = stream.firstAt
  const terminal = arrived.find((event) => event.type === 'run_done' || event.type === 'run_failed')
  const started = arrived.find((event) => event.type === 'run_started')
  const barCount = started?.type === 'run_started' ? started.bar_count : null

  useEffect(() => {
    if (firstArrival === null) return
    const timer = setTimeout(() => setGateTimerDone(true), GATE_MS)
    return () => clearTimeout(timer)
  }, [firstArrival])

  useEffect(() => {
    if (request) return
    let cancelled = false
    history
      .get(id)
      .then((entry) => {
        if (!cancelled && entry) setRequest(entry.request)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id, request])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      getRunStatus(id, { signal: controller.signal })
        .then((document) => {
          setStatus(document)
          setStatusError(null)
          if (document.status === 'queued' || document.status === 'running') timer = setTimeout(load, 2_000)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setStatusError(describeError(error))
        })
    }
    load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [id, terminal])

  const runDone = terminal?.type === 'run_done'
  useEffect(() => {
    if (!runDone) return
    const controller = new AbortController()
    getRunResult(id, { signal: controller.signal })
      .then((payload) => {
        setResult({ status: 'ready', payload })
        setRequest((current) => current ?? payload.request)
        history
          .get(id)
          .then((entry) =>
            history.saveResult(
              entry ??
                entryFromRequest(id, payload.request, {
                  strategyName: payload.result.strategy,
                  market: payload.source.market,
                  sourceMode: payload.source.mode,
                }),
              payload,
            ),
          )
          .catch((error: unknown) => {
            if (error instanceof HistoryError && error.problem !== 'unavailable') setHistoryNote(error.message)
          })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ status: 'error', error: describeError(error) })
      })
    return () => controller.abort()
  }, [id, runDone])

  useEffect(() => {
    if (terminal?.type !== 'run_failed') return
    const state = terminal.code === 'run_cancelled' ? 'cancelled' : 'failed'
    history.update(id, { status: state }).catch(() => undefined)
  }, [id, terminal])

  const payload = result.status === 'ready' ? result.payload : null
  const chartData = useMemo(() => (payload ? chartDataFromResult(payload) : null), [payload])
  const firstIndex = payload?.limits.bars_first_index ?? 0
  const range = useMemo(() => (chartData ? dataRange(chartData.candles) : null), [chartData])

  const gateOpen = payload !== null || gateTimerDone || result.status === 'error' || terminal?.type === 'run_failed'

  const applyStep = useCallback((item: DisplayItem, info: StepInfo) => {
    const handle = crawlerRef.current
    if (handle) applyDisplayItem(handle, item, info)
    if (import.meta.env.DEV) {
      const log = (window.__runPlayback ??= { steps: [] })
      log.steps.push({
        shownAt: info.shownAt,
        hold: info.hold,
        kind: item.kind === 'event' ? item.event.type : 'clusters',
        members: item.kind === 'event' ? 1 : item.members.length,
      })
    }
  }, [])

  const playback = useRunPlayback(arrived, gateOpen, applyStep)
  const displayed = playback.displayed
  const view = useMemo(() => displayed.reduce(reduceRunView, initialRunView()), [displayed])
  const counters = useMemo(() => deriveCounters(displayed, payload), [displayed, payload])
  const displayTerminal = displayed.find((event) => event.type === 'run_done' || event.type === 'run_failed')

  const layout = useMemo<CrawlerLayout | null>(() => {
    if (chartData && projection) return chartLayout(STAGE_REFS, projection, chartData.candles, firstIndex)
    if (barCount !== null) return linearLayout(STAGE_REFS, barCount)
    return null
  }, [chartData, projection, barCount, firstIndex])
  const resolveRegion = useCallback((region: WrapRegion) => (projection ? regionInPrices(region, range) : region), [projection, range])

  const engineRunning = !terminal && (status?.status === 'running' || arrived.length > 0)
  useEffect(() => {
    if (playback.state.displayDone) return
    const timer = setInterval(() => setNow(performance.now()), 200)
    return () => clearInterval(timer)
  }, [playback.state.displayDone])

  const stop = async () => {
    setStopping(true)
    setStopError(null)
    try {
      setStatus(await cancelRun(id))
    } catch (error) {
      setStopError(describeError(error))
    } finally {
      setStopping(false)
    }
  }

  const expired = statusError?.code === 'run_not_found' && arrived.length === 0
  const displayedFailure =
    displayTerminal?.type === 'run_failed' ? describeRunFailure(displayTerminal.code, displayTerminal.message, displayTerminal.stage) : null
  const errors: { key: string; error: DescribedError }[] = [
    ...(displayedFailure ? [{ key: 'run', error: displayedFailure }] : []),
    ...(result.status === 'error' ? [{ key: 'result', error: result.error }] : []),
    ...(stopError ? [{ key: 'stop', error: stopError }] : []),
    ...(statusError && !expired && arrived.length === 0 ? [{ key: 'status', error: statusError }] : []),
    ...(stream.connection === 'lost' && !terminal
      ? [{ key: 'stream', error: { code: 'stream_lost', title: 'The event stream closed', message: 'The connection to the engine closed before the run ended.', action: 'Reload the page to reconnect; the server keeps the events of this run.', stage: null, requestId: null, retryAfter: null } satisfies DescribedError }]
      : []),
  ]

  const strategy: StrategyMetadata | undefined =
    catalog.status === 'ready' ? catalog.catalog.strategies.strategies.find((item) => item.id === request?.strategy_id) : undefined
  const title = `${strategy?.name ?? payload?.result.strategy ?? request?.strategy_id ?? 'Run'} · ${request?.data?.symbol ?? payload?.source.symbol ?? (request?.csv ? 'CSV file' : '')} ${request?.data?.timeframe ?? ''}`.trim()
  const engineSeconds = playback.state.engineSeconds
  const replaying = playback.state.engineDone && !playback.state.displayDone
  const displayVerdict = displayTerminal?.type === 'run_done' ? displayTerminal.verdict : null
  const engineState = expired
    ? 'EXPIRED'
    : terminal
      ? terminal.type === 'run_done'
        ? 'ENGINE DONE'
        : terminal.code === 'run_cancelled'
          ? 'CANCELLED'
          : 'FAILED'
      : status?.status === 'queued'
        ? 'QUEUED'
        : engineRunning
          ? 'ENGINE RUNNING'
          : 'CONNECTING'
  const stageIndex = activeStageIndex(view)
  const percent = overallPercent(view)
  const elapsed = firstArrival === null ? null : now - firstArrival

  if (expired && statusError) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 py-10">
        <h1 className="sr-only-text">Run not available</h1>
        <ErrorPanel
          error={statusError}
          action={
            <span className="flex flex-wrap gap-3">
              <Link className="text-[13px] text-accent-text underline" to={`/app/results/${id}`}>
                Open from this browser's history
              </Link>
              <Link className="text-[13px] text-accent-text underline" to="/app">
                Start a new run
              </Link>
            </span>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:h-[calc(100dvh-100px)] xl:flex-none">
      <h1 className="sr-only-text">Run {title}</h1>
      <div role="toolbar" aria-label="Run" className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line bg-panel-head px-3 py-1.5">
        <span className="label-caps text-ink-3">Display</span>
        <Button
          variant="toggle"
          active={playback.state.paused}
          onClick={() => (playback.state.paused ? playback.resume() : playback.pause())}
          disabled={playback.state.displayDone}
          aria-label={playback.state.paused ? 'Resume the display of events' : 'Pause the display of events'}
        >
          {playback.state.paused ? 'Resume' : 'Pause'}
        </Button>
        <Button onClick={playback.step} disabled={!playback.state.paused || playback.state.pending === 0} aria-label="Show the next event">
          Step
        </Button>
        <span role="group" aria-label="Display speed" className="flex">
          {DISPLAY_SPEEDS.map((speed: DisplaySpeed) => (
            <Button
              key={speed}
              variant="toggle"
              active={playback.state.speed === speed}
              onClick={() => playback.setSpeed(speed)}
              className="-ml-px min-w-11 px-2"
              aria-label={`Display speed ${speed === 'MAX' ? 'maximum' : `${speed} times`}`}
            >
              {speed === 'MAX' ? 'MAX' : `${speed}x`}
            </Button>
          ))}
        </span>
        <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden="true" />
        <Button onClick={() => void stop()} disabled={Boolean(terminal) || stopping || !status || expired} aria-label="Stop the run on the engine">
          {stopping ? 'Stopping' : 'Stop'}
        </Button>
        <span className="min-w-0 truncate pl-2 text-[13px] font-medium text-ink" title={title}>
          {title}
        </span>
        <span data-testid="engine-note" className="ml-auto font-mono text-[11.5px] tracking-[0.04em] text-ink-2 tabular-nums">
          {replaying && engineSeconds !== null
            ? `ENGINE DONE IN ${engineSeconds.toFixed(1)} s · REPLAYING EVENTS`
            : terminal && engineSeconds !== null
              ? `ENGINE ${terminal.type === 'run_done' ? 'DONE' : 'STOPPED'} IN ${engineSeconds.toFixed(1)} s`
              : status?.status === 'queued'
                ? 'QUEUED ON THE ENGINE'
                : elapsed !== null
                  ? `ENGINE RUNNING · ${seconds(elapsed)}`
                  : 'WAITING FOR THE ENGINE'}
        </span>
        {displayVerdict && (
          <span data-testid="verdict" className={`border px-2 py-0.5 font-mono text-[12px] tracking-[0.1em] ${VERDICT_CLASSES[displayVerdict]}`}>
            {VERDICT_LABELS[displayVerdict]}
          </span>
        )}
        {runDone && (
          <Link
            to={`/app/results/${id}`}
            aria-disabled={!payload}
            className={`inline-flex min-h-[34px] items-center border px-3 font-mono text-xs font-medium tracking-[0.06em] uppercase ${payload ? 'border-accent bg-accent text-app hover:brightness-110' : 'pointer-events-none border-line-strong text-ink-3'}`}
          >
            Open results
          </Link>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse xl:flex-row">
        <aside aria-label="Run settings" className="flex shrink-0 flex-col gap-px bg-line xl:w-[300px] xl:overflow-y-auto xl:border-r xl:border-line">
          <RequestDock request={request} strategy={strategy} parameters={payload?.report.run.parameters ?? null} />
          <section aria-labelledby="check-queue" className="flex flex-col bg-panel">
            <h2 id="check-queue" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
              Check queue
            </h2>
            <ol className="m-0 list-none p-0">
              {CHECK_IDS.map((checkId, index) => {
                const check = view.checks[checkId]
                const doneCount = Object.keys(view.checks).length
                const running = !check && view.stages.AUDITOR.state === 'RUN' && index === doneCount
                return (
                  <li key={checkId} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
                    <Tag state={check ? check.status : running ? 'RUN' : 'WAIT'} label={check ? check.status : running ? 'RUN' : 'QUEUED'} />
                    <span className="text-[12.5px] text-ink-2">{CHECK_LABELS[checkId]}</span>
                  </li>
                )
              })}
            </ol>
          </section>
          <div className="hidden flex-1 bg-panel xl:block" />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section id="run-stage" aria-label="Engine stages and chart" className="relative flex min-h-[460px] flex-1 flex-col">
            <ol className="m-0 grid shrink-0 list-none grid-cols-3 border-b border-line bg-panel p-0 sm:grid-cols-6">
              {STAGES.map((stage: Stage, index) => {
                const cell = view.stages[stage]
                return (
                  <li
                    key={stage}
                    id={`run-cell-${index}`}
                    className="relative flex min-w-0 flex-col gap-1 border-r border-b border-line px-2.5 pt-2 pb-3 sm:border-b-0 sm:last:border-r-0"
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className="label-caps truncate text-ink-2">{stage}</span>
                      <Tag state={CELL_TAG[cell.state]} />
                    </span>
                    <span className="truncate font-mono text-[11.5px] text-ink-3" title={cell.detail}>
                      {cell.state === 'WAIT' ? '—' : cell.detail}
                    </span>
                    <span className="absolute right-0 bottom-0 left-0 h-[3px] bg-line" aria-hidden="true">
                      <span className={`block h-full transition-[width] duration-150 ${PROGRESS_CLASSES[cell.state]}`} style={{ width: `${cell.progress}%` }} />
                    </span>
                  </li>
                )
              })}
            </ol>
            <div id="run-chart-box" className="relative min-h-[300px] flex-1 bg-app">
              {chartData ? (
                <HeatmapChart data={chartData} sourceMode={payload?.source.mode ?? null} showTrades={false} showProfile onReady={setProjection} />
              ) : (
                <div className="absolute inset-0 border-l border-line">
                  <span className="absolute top-2 left-[72px] border border-line-strong bg-app px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-ink-3">
                    {terminal?.type === 'run_failed' ? 'NO PRICE DATA FOR THIS RUN' : 'PRICE DATA IS SHOWN WHEN THE ENGINE HAS FINISHED'}
                  </span>
                </div>
              )}
            </div>
            <Crawler
              ref={crawlerRef}
              layout={layout}
              reducedMotion={reducedMotion}
              resolveRegion={resolveRegion}
              {...(import.meta.env.DEV ? { onDebug: exposeCrawler } : {})}
              seed={7}
            />
            <p className="sr-only-text">
              {displayVerdict
                ? `Run completed, ${counters.trades.value} trades, verdict ${VERDICT_LABELS[displayVerdict]}.`
                : displayedFailure
                  ? `Run failed at stage ${displayedFailure.stage ?? 'unknown'}.`
                  : `Stage ${stageIndex} of ${STAGES.length}, ${percent}% shown.`}
            </p>
          </section>

          <div className="grid min-h-[220px] shrink-0 border-t border-line lg:h-[240px] lg:grid-cols-[minmax(0,1fr)_340px]">
            <section aria-label="Run details" className="flex min-h-0 min-w-0 flex-col bg-panel">
              <div role="tablist" aria-label="Run details" className="flex min-h-[34px] flex-wrap border-b border-line bg-panel-head">
                {BOTTOM_TABS.map((item) => {
                  const label =
                    item === 'errors' ? `Errors ${errors.length}` : item === 'counters' ? 'Live counters' : item === 'trades' ? 'Trades' : 'Log'
                  return (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      id={`run-tab-${item}`}
                      aria-selected={tab === item}
                      aria-controls={`run-panel-${item}`}
                      tabIndex={tab === item ? 0 : -1}
                      onClick={() => setTab(item)}
                      onKeyDown={(event) => {
                        const index = BOTTOM_TABS.indexOf(item)
                        const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                        if (!delta) return
                        event.preventDefault()
                        const next = BOTTOM_TABS[(index + delta + BOTTOM_TABS.length) % BOTTOM_TABS.length] ?? 'log'
                        setTab(next)
                        document.getElementById(`run-tab-${next}`)?.focus()
                      }}
                      className={`label-caps -mb-px inline-flex min-h-[34px] items-center border-b-2 px-3 ${tab === item ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'} ${item === 'errors' && errors.length > 0 ? 'text-loss-text' : ''} ${item === 'counters' ? 'lg:hidden' : ''}`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <div role="tabpanel" id={`run-panel-${tab}`} aria-labelledby={`run-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
                {tab === 'log' && <EventLog events={displayed} pending={playback.state.pending} />}
                {tab === 'trades' && <ClusterTable events={displayed} hasResult={Boolean(payload)} />}
                {tab === 'errors' &&
                  (errors.length === 0 ? (
                    <p className="m-0 px-3 py-2 text-[12.5px] text-ink-3">No errors.</p>
                  ) : (
                    <div className="flex flex-col gap-px">
                      {errors.map((item) => (
                        <ErrorPanel
                          key={item.key}
                          error={item.error}
                          compact
                          action={item.key === 'run' ? <Link className="text-[13px] text-accent-text underline" to="/app">Back to configuration</Link> : undefined}
                        />
                      ))}
                    </div>
                  ))}
                {tab === 'counters' && <CounterList counters={Object.values(counters)} />}
              </div>
            </section>
            <section aria-labelledby="live-counters" className="hidden min-h-0 flex-col border-l border-line bg-panel lg:flex">
              <h2 id="live-counters" className="label-caps m-0 flex min-h-[34px] items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
                Live counters
              </h2>
              <CounterList counters={Object.values(counters)} />
            </section>
          </div>
        </div>
      </div>

      {historyNote && <p className="m-0 border-t border-line bg-panel px-3 py-2 text-[12.5px] text-warn-text">{historyNote}</p>}

      <footer className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-panel-head px-3 py-1 font-mono text-[11px] text-ink-3">
        <span data-testid="run-state" className={terminal?.type === 'run_failed' ? 'text-loss-text' : 'text-ink-2'}>
          {engineState}
        </span>
        <span>
          display stage {stageIndex}/{STAGES.length}
        </span>
        <span className="tabular-nums">{percent}% shown</span>
        {payload && <span>net {money(payload.result.metrics.summary.net_pnl)}</span>}
        <span className="ml-auto text-ink-2">Research tool · not financial advice</span>
      </footer>
      <div aria-live="polite" className="sr-only-text">
        {displayVerdict ? `Verdict ${VERDICT_LABELS[displayVerdict]}` : `Stage ${STAGES[Math.max(0, stageIndex - 1)] ?? ''}`}
      </div>
    </div>
  )
}

const STAGE_REFS: StageRefs = {
  stage: () => document.getElementById('run-stage'),
  chartBox: () => document.getElementById('run-chart-box'),
  cells: () => STAGES.map((_, index) => document.getElementById(`run-cell-${index}`)),
}

const exposeCrawler = (debug: CrawlerDebug) => {
  window.__runCrawler = debug
}

function EventLog({ events, pending }: { events: RunEvent[]; pending: number }) {
  if (events.length === 0) return <LoadingLine label="Waiting for the first engine event" />
  return (
    <ol aria-label="Engine events shown" className="m-0 list-none p-0 font-mono text-[11.5px]">
      {pending > 0 && (
        <li className="border-b border-line px-3 py-1 text-ink-3">{pending} more event(s) received, waiting to be shown</li>
      )}
      {events
        .slice(-LOG_LIMIT)
        .reverse()
        .map((event) => (
          <li
            key={event.seq}
            className={`flex gap-2 border-b border-line px-3 py-1 ${event.type === 'run_failed' ? 'text-loss-text' : 'text-ink-2'}`}
          >
            <span className="w-8 shrink-0 text-right text-ink-3 tabular-nums">{event.seq}</span>
            <span className="min-w-0 break-words">{describeEvent(event)}</span>
          </li>
        ))}
    </ol>
  )
}

function ClusterTable({ events, hasResult }: { events: RunEvent[]; hasResult: boolean }) {
  const clusters = events.filter((event) => event.type === 'trade_cluster')
  return (
    <div>
      <p className="m-0 border-b border-line px-3 py-1.5 text-[12px] text-ink-3">
        Groups of closed trades as reported by the engine events.{' '}
        {hasResult ? 'The full trade list is on the results screen.' : 'The full trade list arrives with the result.'}
      </p>
      {clusters.length === 0 ? (
        <p className="m-0 px-3 py-2 text-[12.5px] text-ink-3">No trade cluster shown yet.</p>
      ) : (
        <table className="w-full border-collapse font-mono text-[12px]">
          <caption className="sr-only-text">Trade clusters</caption>
          <thead>
            <tr className="bg-panel-head text-ink-3">
              {['#', 'Bars', 'Trades', 'Fills', 'Net result'].map((header, index) => (
                <th key={header} scope="col" className={`label-caps border-b border-line-strong px-3 py-1 font-medium ${index === 1 ? 'text-left' : 'text-right'}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clusters.map((event, index) =>
              event.type === 'trade_cluster' ? (
                <tr key={event.seq} className="border-b border-line">
                  <td className="px-3 py-1 text-right text-ink-3">{index + 1}</td>
                  <td className="px-3 py-1 text-ink-2">
                    {event.region.start_bar.toLocaleString('en-US')}–{event.region.end_bar.toLocaleString('en-US')}
                  </td>
                  <td className="px-3 py-1 text-right text-ink">{event.fills / 2}</td>
                  <td className="px-3 py-1 text-right text-ink-2">{event.fills}</td>
                  <td className={`px-3 py-1 text-right ${event.net_result > 0 ? 'text-profit-text' : event.net_result < 0 ? 'text-loss-text' : 'text-ink'}`}>
                    {money(event.net_result)}
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CounterList({ counters }: { counters: Counter[] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto]" data-testid="live-counters">
      {counters.map((counter) => (
        <div key={counter.label} className="col-span-2 grid grid-cols-subgrid border-b border-line">
          <dt className="px-3 py-1.5 text-[12.5px] text-ink-2">
            {counter.label}
            <span className="ml-2 font-mono text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              {counter.source === 'events' ? 'from events' : counter.source === 'result' ? 'from result' : 'after result'}
            </span>
          </dt>
          <dd
            className={`m-0 px-3 py-1.5 text-right font-mono text-data tabular-nums ${counter.tone === 'loss' ? 'text-loss-text' : counter.tone === 'profit' ? 'text-profit-text' : 'text-ink'}`}
          >
            {counter.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
