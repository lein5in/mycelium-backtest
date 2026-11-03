import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STAGES } from '../api/runEvents'
import { Crawler, type CrawlerDebug } from '../features/crawler/Crawler'
import { DEFAULT_PARAMS, PARAM_SPECS, type CrawlerParams } from '../features/crawler/params'
import type { CrawlerHandle, CrawlerLayout, CrawlerMeasure, Point } from '../features/crawler/types'
import { Button } from '../ui/Button'

const LAB_BARS = 400
const PORT_INSET = 6
const WRAP_HALF_BARS = 16
const WRAP_HALF_PRICE = 0.07

declare global {
  interface Window {
    __crawler?: CrawlerDebug
  }
}

const exposeCrawler = (debug: CrawlerDebug) => {
  window.__crawler = debug
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function formatValue(key: keyof CrawlerParams, value: number): string {
  const spec = PARAM_SPECS[key]
  const decimals = spec.step < 1 ? (spec.step < 0.1 ? 2 : 1) : 0
  return `${value.toFixed(decimals)}${spec.unit ? ` ${spec.unit}` : ''}`
}

export function CrawlerLab() {
  const stageRef = useRef<HTMLDivElement>(null)
  const crawlerRef = useRef<CrawlerHandle>(null)
  const sweepRef = useRef<number | null>(null)
  const [params, setParams] = useState<CrawlerParams>(DEFAULT_PARAMS)
  const [seed, setSeed] = useState(1)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const [armedWrap, setArmedWrap] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')

  const layout = useMemo<CrawlerLayout>(() => {
    const plotOf = (width: number, height: number) => ({
      left: 0,
      top: PORT_INSET,
      width,
      height: height - PORT_INSET,
    })
    const size = () => {
      const stage = stageRef.current
      return stage ? { width: stage.clientWidth, height: stage.clientHeight } : null
    }
    const measure = (): CrawlerMeasure | null => {
      const current = size()
      if (!current || current.width <= 0 || current.height <= 0) return null
      const cell = current.width / STAGES.length
      return {
        stage: current,
        ports: STAGES.map((_, index) => ({ x: cell * (index + 0.5), y: PORT_INSET })),
        plot: plotOf(current.width, current.height),
      }
    }
    const project = (bar: number, price: number): Point | null => {
      const current = size()
      if (!current) return null
      const plot = plotOf(current.width, current.height)
      return {
        x: plot.left + (bar / (LAB_BARS - 1)) * plot.width,
        y: plot.top + (1 - price) * plot.height,
      }
    }
    return {
      measure,
      project,
      visiblePriceRange: () => ({ low: 0, high: 1 }),
      anchors: () => [],
      priceAt: (bar) => 0.5 + 0.18 * Math.sin(bar / 37),
      subscribe: () => () => undefined,
    }
  }, [])

  useEffect(
    () => () => {
      if (sweepRef.current !== null) window.clearInterval(sweepRef.current)
    },
    [],
  )

  const stopSweep = () => {
    if (sweepRef.current !== null) window.clearInterval(sweepRef.current)
    sweepRef.current = null
  }

  const spawn = () => {
    stopSweep()
    crawlerRef.current?.reset()
    crawlerRef.current?.start(LAB_BARS)
  }

  const crawl = () => {
    const stage = stageRef.current
    const handle = crawlerRef.current
    if (!stage || !handle) return
    stopSweep()
    const y = stage.clientHeight * 0.55
    const left = { x: stage.clientWidth * 0.08, y }
    const right = { x: stage.clientWidth * 0.92, y }
    handle.moveSpiderTo(left)
    let leg: 'out' | 'back' = 'out'
    sweepRef.current = window.setInterval(() => {
      const spider = window.__crawler?.model.spider
      if (!spider || spider.state !== 'idle') return
      if (leg === 'out') {
        handle.moveSpiderTo(right)
        leg = 'back'
      } else stopSweep()
    }, 120)
  }

  const onStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!armedWrap) return
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const bar = (x / rect.width) * (LAB_BARS - 1)
    const price = 1 - (y - PORT_INSET) / (rect.height - PORT_INSET)
    stopSweep()
    crawlerRef.current?.wrap({
      startBar: Math.max(0, bar - WRAP_HALF_BARS),
      endBar: Math.min(LAB_BARS - 1, bar + WRAP_HALF_BARS),
      priceLow: Math.max(0, price - WRAP_HALF_PRICE),
      priceHigh: Math.min(1, price + WRAP_HALF_PRICE),
      units: 'price',
      label: 'WRAP TEST · LAB',
    })
    setArmedWrap(false)
  }

  const copyParameters = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ seed, ...params }, null, 2))
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }, [params, seed])

  const keys = Object.keys(PARAM_SPECS) as (keyof CrawlerParams)[]

  return (
    <main className="flex h-full min-h-[640px] flex-col bg-app">
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line bg-panel-head px-3 py-1.5">
        <h1 className="label-caps m-0 mr-3 font-medium text-ink-2">
          Crawler lab <span className="text-ink-3">· development only</span>
        </h1>
        <Button variant="primary" onClick={spawn}>
          Spawn
        </Button>
        <Button onClick={crawl}>Crawl left to right</Button>
        <Button active={armedWrap} aria-pressed={armedWrap} onClick={() => setArmedWrap((value) => !value)}>
          Wrap here
        </Button>
        <Button
          onClick={() => {
            stopSweep()
            crawlerRef.current?.finish()
          }}
        >
          Rest
        </Button>
        <Button
          onClick={() => {
            stopSweep()
            crawlerRef.current?.fail('SIMULATOR')
          }}
        >
          Freeze (failure)
        </Button>
        <Button
          variant="toggle"
          active={reducedMotion}
          aria-pressed={reducedMotion}
          onClick={() => setReducedMotion((value) => !value)}
        >
          Reduce motion
        </Button>
        <label className="ml-auto flex items-center gap-2 font-mono text-data text-ink-3">
          Seed
          <input
            type="number"
            min={1}
            max={999999}
            value={seed}
            onChange={(event) => setSeed(Math.max(1, Math.min(999999, Math.round(Number(event.target.value) || 1))))}
            className="h-[34px] w-24 border border-line-strong bg-app px-2 text-right font-mono text-data text-ink"
          />
        </label>
        <Button onClick={() => void copyParameters()}>Copy parameters</Button>
        <span className="w-16 font-mono text-[11px] text-ink-3" aria-live="polite">
          {copied === 'copied' ? 'copied' : copied === 'failed' ? 'blocked' : ''}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          ref={stageRef}
          onClick={onStageClick}
          className={`relative min-h-[420px] flex-1 overflow-hidden bg-app ${armedWrap ? 'cursor-crosshair' : ''}`}
          aria-label="Crawler stage"
          role="region"
        >
          <Crawler
            ref={crawlerRef}
            layout={layout}
            reducedMotion={reducedMotion}
            seed={seed}
            params={params}
            onDebug={exposeCrawler}
          />
          {armedWrap && (
            <p className="pointer-events-none absolute top-3 left-3 z-30 m-0 border border-line-strong bg-panel px-2 py-1 font-mono text-[11px] text-ink-2">
              Click the stage to choose the wrap point
            </p>
          )}
        </div>

        <aside className="shrink-0 border-t border-line bg-panel lg:w-[320px] lg:border-t-0 lg:border-l">
          <div className="flex h-8 items-center justify-between border-b border-line bg-panel-head px-3">
            <h2 className="label-caps m-0 font-medium text-ink-3">Parameters</h2>
            <button
              type="button"
              onClick={() => setParams(DEFAULT_PARAMS)}
              className="font-mono text-[11px] text-accent-text underline"
            >
              Defaults
            </button>
          </div>
          <dl className="m-0">
            {keys.map((key) => {
              const spec = PARAM_SPECS[key]
              const id = `param-${key}`
              return (
                <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
                  <dt>
                    <label htmlFor={id} className="text-data text-ink-2">
                      {spec.label}
                    </label>
                  </dt>
                  <dd className="m-0 text-right font-mono text-data text-ink tabular-nums">{formatValue(key, params[key])}</dd>
                  <dd className="col-span-2 m-0">
                    <input
                      id={id}
                      type="range"
                      min={spec.min}
                      max={spec.max}
                      step={spec.step}
                      value={params[key]}
                      onChange={(event) => setParams((current) => ({ ...current, [key]: Number(event.target.value) }))}
                      className="w-full accent-[var(--accent)]"
                    />
                  </dd>
                </div>
              )
            })}
          </dl>
        </aside>
      </div>

      <footer className="flex h-7 shrink-0 items-center border-t border-line bg-panel-head px-3 font-mono text-[11px] text-ink-3">
        <span>No engine connected · every movement here is triggered by these controls</span>
        <span className="ml-auto">Research tool · not financial advice</span>
      </footer>
    </main>
  )
}
