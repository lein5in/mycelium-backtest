import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { STAGES, type RunEvent } from '../../api/runEvents'
import { HeatmapChart, type ChartProjection } from '../chart/HeatmapChart'
import { chartDataFromResult } from '../chart/fromResult'
import { Crawler } from '../crawler/Crawler'
import { applyDisplayItem, membersOf, type DisplayItem, type StepInfo } from '../crawler/playback'
import type { CrawlerHandle } from '../crawler/types'
import { chartLayout, dataRange, regionInPrices, type StageRefs } from '../run/layouts'
import { initialRunView, reduceRunView, type CellState } from '../run/runView'
import { useRunPlayback } from '../run/useRunPlayback'
import { Tag, type TagState } from '../../ui/Tag'
import { RecordedFallback } from './RecordedFallback'
import { canvasSupported, RECORDED_LABEL, recordedSummary, type RecordedRun } from './recordedRun'

const LOOP_PAUSE_MS = 4_000
const CELL_TAG: Record<CellState, TagState> = { WAIT: 'WAIT', RUN: 'RUN', DONE: 'DONE', FAIL: 'FAIL' }
const PROGRESS: Record<CellState, string> = { WAIT: 'bg-line-strong', RUN: 'bg-accent', DONE: 'bg-violet', FAIL: 'bg-loss' }

type RecordedRunFrameProps = {
  run: RecordedRun
  showTrades?: boolean
  className?: string
  forceStatic?: boolean
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function RecordedRunFrame({ run, showTrades = false, className = '', forceStatic = false }: RecordedRunFrameProps) {
  const [staticOnly] = useState(() => forceStatic || prefersReducedMotion() || !canvasSupported())
  return (
    <figure className={`m-0 flex flex-col border border-line-strong bg-app shadow-[0_24px_60px_rgba(0,0,0,0.55)] ${className}`} data-testid="recorded-frame">
      <div className="flex min-h-8 items-center gap-2 border-b border-line bg-panel-head px-3">
        <span className="border border-warn px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-warn-text" data-testid="recorded-label">
          {RECORDED_LABEL}
        </span>
        <span className="truncate font-mono text-[11px] text-ink-3">
          {run.payload.result.strategy}, {run.payload.source.symbol} {run.payload.source.timeframe}, replay of real engine events
        </span>
      </div>
      {staticOnly ? <RecordedFallback run={run} /> : <LiveRecorded run={run} showTrades={showTrades} />}
      <figcaption className="sr-only-text">{recordedSummary(run)}</figcaption>
    </figure>
  )
}

function LiveRecorded({ run, showTrades }: { run: RecordedRun; showTrades: boolean }) {
  const prefix = `rec${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const hostRef = useRef<HTMLDivElement>(null)
  const crawlerRef = useRef<CrawlerHandle>(null)
  const chartData = useMemo(() => chartDataFromResult(run.payload), [run])
  const range = useMemo(() => dataRange(chartData.candles), [chartData])
  const [projection, setProjection] = useState<ChartProjection | null>(null)
  const [loop, setLoop] = useState(0)
  const [displayed, setDisplayed] = useState<RunEvent[]>([])
  const [active, setActive] = useState(true)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let onScreen = true
    let visible = document.visibilityState === 'visible'
    const update = () => setActive(onScreen && visible)
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting)
      update()
    })
    observer.observe(host)
    const onVisibility = () => {
      visible = document.visibilityState === 'visible'
      update()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const refs = useMemo<StageRefs>(
    () => ({
      stage: () => document.getElementById(`${prefix}-stage`),
      chartBox: () => document.getElementById(`${prefix}-chart`),
      cells: () => STAGES.map((_, index) => document.getElementById(`${prefix}-cell-${index}`)),
    }),
    [prefix],
  )
  const layout = useMemo(() => (projection ? chartLayout(refs, projection, chartData.candles, 0) : null), [refs, projection, chartData])
  const resolveRegion = useCallback((region: Parameters<typeof regionInPrices>[0]) => regionInPrices(region, range), [range])

  const onStep = useCallback((item: DisplayItem, info: StepInfo) => {
    const handle = crawlerRef.current
    if (handle) applyDisplayItem(handle, item, info)
    setDisplayed((current) => [...current, ...membersOf(item)])
  }, [])

  const restart = useCallback(() => {
    crawlerRef.current?.reset()
    setDisplayed([])
    setLoop((value) => value + 1)
  }, [])

  const view = useMemo(() => displayed.reduce(reduceRunView, initialRunView()), [displayed])

  return (
    <div ref={hostRef} id={`${prefix}-stage`} className="relative flex min-h-0 flex-1 flex-col">
      <ol className="m-0 grid shrink-0 list-none grid-cols-3 border-b border-line bg-panel p-0 sm:grid-cols-6" aria-hidden="true">
        {STAGES.map((stage, index) => {
          const cell = view.stages[stage]
          return (
            <li key={stage} id={`${prefix}-cell-${index}`} className="relative flex min-w-0 flex-col gap-1 border-r border-b border-line px-2 pt-1.5 pb-2.5 sm:border-b-0 sm:last:border-r-0">
              <span className="flex items-center justify-between gap-1">
                <span className="truncate font-mono text-[10.5px] tracking-[0.1em] text-ink-2">{stage}</span>
                <Tag state={CELL_TAG[cell.state]} />
              </span>
              <span className="truncate font-mono text-[10.5px] text-ink-3">{cell.state === 'WAIT' ? '—' : cell.detail}</span>
              <span className="absolute right-0 bottom-0 left-0 h-[3px] bg-line">
                <span className={`block h-full ${PROGRESS[cell.state]}`} style={{ width: `${cell.progress}%` }} />
              </span>
            </li>
          )
        })}
      </ol>
      <div id={`${prefix}-chart`} className="relative min-h-0 flex-1">
        <HeatmapChart
          data={chartData}
          sourceMode="SAMPLE DATA"
          showTrades={showTrades}
          showProfile
          onReady={setProjection}
          label="Recorded run chart: synthetic SAMPLE-A prices with the volume heatmap"
        />
      </div>
      <Crawler ref={crawlerRef} layout={layout} reducedMotion={false} resolveRegion={resolveRegion} seed={11} />
      {projection && <Driver key={loop} events={run.events} active={active} onStep={onStep} onDone={restart} />}
    </div>
  )
}

function Driver({
  events,
  active,
  onStep,
  onDone,
}: {
  events: RunEvent[]
  active: boolean
  onStep: (item: DisplayItem, info: StepInfo) => void
  onDone: () => void
}) {
  const playback = useRunPlayback(events, true, onStep)
  const { pause, resume } = playback
  const done = playback.state.displayDone

  useEffect(() => {
    if (active) resume()
    else pause()
  }, [active, pause, resume])

  useEffect(() => {
    if (!done || !active) return
    const timer = setTimeout(onDone, LOOP_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [done, active, onDone])

  return null
}
