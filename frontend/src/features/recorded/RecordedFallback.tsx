import { STAGES } from '../../api/runEvents'
import { Tag } from '../../ui/Tag'
import { recordedSummary, type RecordedRun } from './recordedRun'
import { fallbackGeometry } from './fallbackGeometry'

const WIDTH = 800
const HEIGHT = 380

export function RecordedFallback({ run }: { run: RecordedRun }) {
  const geometry = fallbackGeometry(run, WIDTH, HEIGHT)
  return (
    <div className="flex flex-col" data-testid="recorded-fallback">
      <ol className="m-0 grid list-none grid-cols-3 border-b border-line bg-panel p-0 sm:grid-cols-6" aria-hidden="true">
        {STAGES.map((stage) => (
          <li key={stage} className="flex items-center justify-between gap-1 border-r border-b border-line px-2 py-1.5 sm:border-b-0 sm:last:border-r-0">
            <span className="font-mono text-[10.5px] tracking-[0.1em] text-ink-2">{stage}</span>
            <Tag state="DONE" />
          </li>
        ))}
      </ol>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full bg-app" role="img" aria-label={recordedSummary(run)}>
        {geometry.clusters.map((box, index) => (
          <rect
            key={index}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            fill="var(--violet)"
            fillOpacity={0.06}
            stroke="var(--violet-text)"
            strokeOpacity={0.7}
            strokeDasharray="4 3"
          />
        ))}
        <polyline points={geometry.price} fill="none" stroke="var(--price-line)" strokeOpacity={0.8} strokeWidth={1} />
        <text x={12} y={HEIGHT - 10} fill="var(--text-3)" fontSize={11} fontFamily="IBM Plex Mono, monospace">
          Final state of the recorded run · {geometry.clusters.length} trade clusters wrapped
        </text>
      </svg>
    </div>
  )
}
