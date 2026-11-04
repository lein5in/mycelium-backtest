import type { RandomEntries } from '../../api/result'
import { money } from './format'
import { HEIGHT, histogramGeometry, WIDTH } from './reportModel'

export function RandomHistogram({ random, passPercentile }: { random: RandomEntries; passPercentile: number | null }) {
  const geometry = histogramGeometry(random)
  if (!geometry) {
    return (
      <p className="m-0 px-3 py-2 text-[12.5px] text-ink-2">
        No comparison was possible: the run has no trade to mirror with random entries.
      </p>
    )
  }
  const percentile = random.percentile
  return (
    <figure className="m-0 flex flex-col gap-2 px-3 py-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Histogram of ${random.draws} random-entry results; this run's net result ${money(random.real_net_pnl)} is at the ${percentile?.toFixed(1) ?? 'unknown'} percentile.`}
      >
        {geometry.bars.map((bar, index) => (
          <rect
            key={index}
            x={bar.left}
            y={bar.top}
            width={bar.width}
            height={bar.height}
            fill={bar.real ? 'var(--accent)' : 'var(--border-strong)'}
          />
        ))}
        <line x1={geometry.realX} x2={geometry.realX} y1={2} y2={geometry.baseline} stroke="var(--accent-text)" strokeWidth={1.5} />
        <line x1={0} x2={WIDTH} y1={geometry.baseline + 0.5} y2={geometry.baseline + 0.5} stroke="var(--border)" />
        <text x={2} y={HEIGHT - 4} fill="var(--text-3)" fontSize={10} fontFamily="IBM Plex Mono, monospace">
          {money(geometry.low, 0)}
        </text>
        <text x={WIDTH - 2} y={HEIGHT - 4} fill="var(--text-3)" fontSize={10} fontFamily="IBM Plex Mono, monospace" textAnchor="end">
          {money(geometry.high, 0)}
        </text>
      </svg>
      <figcaption className="flex flex-col gap-1 text-[12.5px] leading-relaxed text-ink-2">
        <span>
          This run: <span className="font-mono text-ink">{money(random.real_net_pnl)}</span>, at the{' '}
          <span className="font-mono text-ink" data-testid="random-percentile">
            {percentile === null ? '—' : `${percentile.toFixed(1)}th`}
          </span>{' '}
          percentile of {random.draws.toLocaleString('en-US')} random-entry runs (same number of trades and holding times, random entry
          times and directions, same costs){passPercentile !== null ? `; the pass bar is the ${passPercentile}th` : ''}.
        </span>
        <span className="text-ink-3">
          The percentile says how often random timing did worse on this same data. It does not say the strategy will make money, and a
          high percentile on one data set can still be luck.
        </span>
      </figcaption>
    </figure>
  )
}
