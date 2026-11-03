import { useCallback, useMemo, useRef, useState } from 'react'
import { HeatmapChart, type ChartProjection } from '../features/chart/HeatmapChart'
import { generateSampleData } from '../features/chart/sampleData'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { frameStats, probeRange, type FrameStats } from './frameStats'

const PROBE_FRAMES = 360

declare global {
  interface Window {
    __heatmapProbe?: FrameStats
  }
}

export function HeatmapSpike() {
  const data = useMemo(() => generateSampleData(), [])
  const projectionRef = useRef<ChartProjection | null>(null)
  const [stats, setStats] = useState<FrameStats | null>(null)
  const [probing, setProbing] = useState(false)

  const handleReady = useCallback((projection: ChartProjection | null) => {
    projectionRef.current = projection
  }, [])

  const runProbe = () => {
    const projection = projectionRef.current
    if (!projection || probing) return
    setProbing(true)
    setStats(null)
    const timeScale = projection.chart.timeScale()
    const deltas: number[] = []
    let frame = 0
    let previous = performance.now()
    const step = (now: number) => {
      if (frame > 0) deltas.push(now - previous)
      previous = now
      if (frame >= PROBE_FRAMES) {
        const result = frameStats(deltas)
        window.__heatmapProbe = result
        setStats(result)
        setProbing(false)
        timeScale.fitContent()
        return
      }
      timeScale.setVisibleLogicalRange(probeRange(frame, PROBE_FRAMES, projection.barCount))
      frame += 1
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  return (
    <main className="flex h-full flex-col gap-px bg-line p-px">
      <header className="flex h-10 items-center justify-between bg-panel-head px-3">
        <h1 className="label-caps m-0 font-medium text-ink-2">
          Spike · heatmap primitive <span className="text-ink-3">· development only</span>
        </h1>
        <div className="flex items-center gap-3">
          <span className="font-mono text-data text-ink-3" aria-live="polite" data-testid="probe-result">
            {stats
              ? `${stats.frames} frames · p50 ${stats.p50.toFixed(1)} ms · p95 ${stats.p95.toFixed(1)} ms · max ${stats.max.toFixed(1)} ms`
              : probing
                ? 'probing…'
                : 'frame probe idle'}
          </span>
          <Button onClick={runProbe} disabled={probing}>
            Run frame probe
          </Button>
        </div>
      </header>
      <Panel
        label={`Heatmap · ${data.grid.columns} × ${data.grid.rows} cells · ${data.trades.length} sample trades`}
        className="min-h-0 flex-1"
      >
        <div className="h-full min-h-[420px]">
          <HeatmapChart data={data} onReady={handleReady} />
        </div>
      </Panel>
    </main>
  )
}
