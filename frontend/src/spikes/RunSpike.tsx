import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STAGES, type RunEvent, type Stage, type Verdict } from '../api/runEvents'
import { createFakeRun, createRealRun, openRunEvents, type ScenarioName } from '../api/runs'
import { HeatmapChart, type ChartProjection } from '../features/chart/HeatmapChart'
import { chartDataFromSample, defaultSampleOptions, generateSampleData } from '../features/chart/sampleData'
import { Crawler, type CrawlerDebug, type CrawlerEventSource } from '../features/crawler/Crawler'
import type { CrawlerHandle, CrawlerLayout, CrawlerMeasure, WrapRegion } from '../features/crawler/types'
import { Button } from '../ui/Button'
import { snapRegionToCandles } from './clusterSnap'
import { Tag, type TagState } from '../ui/Tag'
import {
  activeStageIndex,
  describeEvent,
  initialRunView,
  overallPercent,
  reduceRunView,
  type CellState,
  type RunView,
} from './runState'

const LOG_LIMIT = 200

const REAL_RUN_BARS = 4758
const REAL_RUN = {
  strategy_id: 'rsi_mean_reversion',
  data: {
    provider: 'samples',
    symbol: 'SAMPLE-A',
    timeframe: '5m',
    start: '2024-01-02T00:00:00Z',
    end: '2024-04-01T00:00:00Z',
  },
}

type RunKind = ScenarioName | 'real'

declare global {
  interface Window {
    __crawler?: CrawlerDebug
  }
}

const exposeCrawler = (debug: CrawlerDebug) => {
  window.__crawler = debug
}

const verdictClasses: Record<Verdict, string> = {
  CREDIBLE: 'border-profit text-profit-text',
  FRAGILE: 'border-warn text-warn-text',
  NOT_CREDIBLE: 'border-loss text-loss-text',
}

const cellTag: Record<CellState, TagState> = { WAIT: 'WAIT', RUN: 'RUN', DONE: 'DONE', FAIL: 'FAIL' }

const progressClasses: Record<CellState, string> = {
  WAIT: 'bg-line-strong',
  RUN: 'bg-accent',
  DONE: 'bg-violet',
  FAIL: 'bg-loss',
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

type LogLine = { seq: number; text: string; tone: 'normal' | 'fail' }

export function RunSpike() {
  const [chartBars, setChartBars] = useState(defaultSampleOptions.bars)
  const chartBarsRef = useRef(defaultSampleOptions.bars)
  const data = useMemo(
    () => chartDataFromSample(generateSampleData({ ...defaultSampleOptions, bars: chartBars })),
    [chartBars],
  )
  const resolveRegion = useCallback((region: WrapRegion) => snapRegionToCandles(region, data.candles), [data])
  const stageRef = useRef<HTMLDivElement>(null)
  const chartBoxRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<(HTMLDivElement | null)[]>([])
  const crawlerRef = useRef<CrawlerHandle>(null)
  const listenersRef = useRef(new Set<(event: RunEvent) => void>())
  const closeStreamRef = useRef<(() => void) | null>(null)

  const [projection, setProjection] = useState<ChartProjection | null>(null)
  const [view, setView] = useState<RunView>(initialRunView)
  const [log, setLog] = useState<LogLine[]>([])
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => performance.now())
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const events = useCallback<CrawlerEventSource>((listener) => {
    const listeners = listenersRef.current
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])

  const layout = useMemo<CrawlerLayout | null>(() => {
    if (!projection) return null
    const offset = { left: 0, top: 0 }
    const measure = (): CrawlerMeasure | null => {
      const stage = stageRef.current
      const chartBox = chartBoxRef.current
      const pane = projection.paneRect()
      if (!stage || !chartBox || !pane) return null
      const stageRect = stage.getBoundingClientRect()
      const chartRect = chartBox.getBoundingClientRect()
      offset.left = chartRect.left - stageRect.left + pane.left
      offset.top = chartRect.top - stageRect.top + pane.top
      const ports = cellRefs.current.map((cell) => {
        const rect = cell?.getBoundingClientRect()
        return rect
          ? { x: rect.left - stageRect.left + rect.width / 2, y: rect.bottom - stageRect.top }
          : { x: 0, y: 0 }
      })
      return {
        stage: { width: stageRect.width, height: stageRect.height },
        ports,
        plot: { left: offset.left, top: offset.top, width: pane.width, height: pane.height },
      }
    }
    return {
      measure,
      project: (bar, price) => {
        const x = projection.barToX(bar)
        const y = projection.priceToY(price)
        return x === null || y === null ? null : { x: x + offset.left, y: y + offset.top }
      },
      visiblePriceRange: () => {
        const pane = projection.paneRect()
        if (!pane) return null
        const high = projection.yToPrice(0)
        const low = projection.yToPrice(pane.height)
        return high === null || low === null ? null : { low, high }
      },
      anchors: () => projection.anchors,
      priceAt: (bar) => data.candles[Math.round(bar)]?.close ?? null,
      subscribe: (listener) => {
        const timeScale = projection.chart.timeScale()
        timeScale.subscribeVisibleLogicalRangeChange(listener)
        timeScale.subscribeSizeChange(listener)
        return () => {
          timeScale.unsubscribeVisibleLogicalRangeChange(listener)
          timeScale.unsubscribeSizeChange(listener)
        }
      },
    }
  }, [projection, data])

  const running = view.phase === 'connecting' || view.phase === 'running'

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(timer)
  }, [running])

  useEffect(() => () => closeStreamRef.current?.(), [])

  const handleEvent = useCallback((event: RunEvent) => {
    for (const listener of listenersRef.current) listener(event)
    setView((current) => reduceRunView(current, event))
    setLog((current) =>
      [...current, { seq: event.seq, text: describeEvent(event), tone: event.type === 'run_failed' ? 'fail' : 'normal' } as LogLine].slice(-LOG_LIMIT),
    )
    if (event.type === 'run_started' && event.bar_count !== chartBarsRef.current)
      setError(`The run has ${event.bar_count} bars but the placeholder chart has ${chartBarsRef.current}.`)
    if (event.type === 'stage_started') setAnnouncement(`Stage ${event.stage} started`)
    if (event.type === 'run_done') {
      setAnnouncement(`Run completed, verdict ${event.verdict.replace('_', ' ')}`)
      setEndedAt(performance.now())
    }
    if (event.type === 'run_failed') {
      setAnnouncement(`Run failed at stage ${event.stage}. ${event.message}`)
      setEndedAt(performance.now())
    }
  }, [])

  const start = async (kind: RunKind) => {
    closeStreamRef.current?.()
    const bars = kind === 'real' ? REAL_RUN_BARS : defaultSampleOptions.bars
    if (bars !== chartBarsRef.current) {
      setProjection(null)
      chartBarsRef.current = bars
      setChartBars(bars)
    }
    crawlerRef.current?.reset()
    setView({ ...initialRunView(), phase: 'connecting' })
    setLog([])
    setError(null)
    setEndedAt(null)
    const startTime = performance.now()
    setStartedAt(startTime)
    setNow(startTime)
    try {
      const run = kind === 'real' ? await createRealRun(REAL_RUN) : await createFakeRun(kind)
      closeStreamRef.current = openRunEvents(run.events_url, {
        onEvent: handleEvent,
        onInvalid: () => setError('The engine sent an event this page cannot read.'),
        onConnectionLost: () => {
          setView((current) => ({ ...current, phase: 'lost' }))
          setError('Connection to the engine was lost. Start the run again.')
          setEndedAt(performance.now())
        },
      })
    } catch {
      setView((current) => ({ ...current, phase: 'lost' }))
      setError('The engine is unreachable. Start the backend dev server, then try again.')
      setEndedAt(performance.now())
    }
  }

  const elapsed = startedAt === null ? 0 : (endedAt ?? now) - startedAt
  const percent = overallPercent(view)
  const stageIndex = activeStageIndex(view)
  const engineState = {
    idle: 'IDLE',
    connecting: 'CONNECTING',
    running: 'RUNNING',
    done: 'DONE',
    failed: 'FAILED',
    lost: 'DISCONNECTED',
  }[view.phase]
  const summary =
    view.phase === 'done'
      ? `Run completed, ${STAGES.length} stages, verdict ${view.verdict?.replace('_', ' ')}.`
      : view.phase === 'failed'
        ? `Run failed at stage ${view.failure?.stage}.`
        : `Run ${engineState.toLowerCase()}, stage ${stageIndex} of ${STAGES.length}, ${percent}%.`

  return (
    <main className="flex h-full min-h-[640px] flex-col bg-app">
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line bg-panel-head px-3 py-1.5">
        <h1 className="label-caps m-0 mr-3 font-medium text-ink-2">
          Spike · run crawler <span className="text-ink-3">· development only</span>
        </h1>
        <Button variant="primary" onClick={() => void start('success')} disabled={running}>
          Start fake run
        </Button>
        <Button onClick={() => void start('failure')} disabled={running}>
          Start failing run
        </Button>
        <Button onClick={() => void start('real')} disabled={running}>
          Start real run
        </Button>
        <Button
          variant="toggle"
          active={reducedMotion}
          aria-pressed={reducedMotion}
          onClick={() => setReducedMotion((value) => !value)}
        >
          Reduce motion
        </Button>
        <div className="ml-auto flex items-center gap-3 font-mono text-data">
          <span className="text-ink-3">elapsed</span>
          <span className="w-14 text-right text-ink tabular-nums">{formatElapsed(elapsed)}</span>
          {view.verdict && (
            <span
              data-testid="verdict"
              className={`border px-2 py-0.5 text-[11px] tracking-[0.1em] ${verdictClasses[view.verdict]}`}
            >
              {view.verdict.replace('_', ' ')}
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section key={chartBars} ref={stageRef} className="relative flex min-h-[460px] min-w-0 flex-1 flex-col" aria-label="Run stage">
          <div className="grid shrink-0 grid-cols-6 border-b border-line bg-panel">
            {STAGES.map((stage: Stage, index) => {
              const cell = view.stages[stage]
              return (
                <div
                  key={stage}
                  ref={(element) => {
                    cellRefs.current[index] = element
                  }}
                  className="relative flex min-w-0 flex-col gap-1 border-r border-line px-2.5 pt-2 pb-3 last:border-r-0"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="label-caps truncate text-ink-2">{stage}</span>
                    <Tag state={cellTag[cell.state]} />
                  </div>
                  <span className="truncate font-mono text-[11.5px] text-ink-3" title={cell.detail}>
                    {cell.detail}
                  </span>
                  <span className="absolute right-0 bottom-0 left-0 h-[3px] bg-line">
                    <span
                      className={`block h-full transition-[width] duration-150 ${progressClasses[cell.state]}`}
                      style={{ width: `${cell.progress}%` }}
                    />
                  </span>
                </div>
              )
            })}
          </div>
          <div ref={chartBoxRef} className="relative min-h-0 flex-1">
            <HeatmapChart data={data} sourceMode="SAMPLE DATA" showTrades={false} onReady={setProjection} />
          </div>
          <Crawler
            ref={crawlerRef}
            layout={layout}
            reducedMotion={reducedMotion}
            events={events}
            resolveRegion={resolveRegion}
            onDebug={exposeCrawler}
            seed={1}
          />
          <p className="sr-only-text">{summary}</p>
        </section>

        <aside className="flex h-56 shrink-0 flex-col border-t border-line bg-panel lg:h-auto lg:w-[340px] lg:border-t-0 lg:border-l">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-panel-head px-3">
            <h2 className="label-caps m-0 font-medium text-ink-3">Log</h2>
            <span className="font-mono text-[11px] text-ink-3">{log.length} events</span>
          </div>
          {error && (
            <p role="alert" className="m-0 border-b border-line px-3 py-2 text-data text-loss-text">
              {error}
            </p>
          )}
          {view.failure && (
            <p className="m-0 border-b border-line px-3 py-2 text-data text-loss-text">
              {view.failure.stage} failed: {view.failure.message}
            </p>
          )}
          <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 font-mono text-[11.5px]" data-testid="event-log">
            {log.length === 0 && <li className="px-3 py-2 text-ink-3">No events yet. Start a fake run.</li>}
            {log.map((line) => (
              <li
                key={line.seq}
                className={`flex gap-2 border-b border-line px-3 py-1 ${line.tone === 'fail' ? 'text-loss-text' : 'text-ink-2'}`}
              >
                <span className="w-7 shrink-0 text-right text-ink-3 tabular-nums">{line.seq}</span>
                <span className="min-w-0 break-words">{line.text}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel-head px-3 font-mono text-[11px] text-ink-3">
        <span className={view.phase === 'failed' || view.phase === 'lost' ? 'text-loss-text' : 'text-ink-2'}>
          {engineState}
        </span>
        <span>
          stage {stageIndex}/{STAGES.length}
        </span>
        <span className="tabular-nums">{percent}%</span>
        <span className="ml-auto">Research tool · not financial advice</span>
      </footer>
      <div aria-live="polite" className="sr-only-text">
        {announcement}
      </div>
    </main>
  )
}
