import type { RecordedRun } from './recordedRun'

export type Box = { x: number; y: number; width: number; height: number }

const POINTS = 400
const PAD = 16

export function fallbackGeometry(run: RecordedRun, width: number, height: number) {
  const { low, high, close } = run.payload.bars
  const count = close.length
  const minimum = Math.min(...low)
  const maximum = Math.max(...high)
  const span = maximum - minimum || 1
  const x = (bar: number) => PAD + (bar / Math.max(1, count - 1)) * (width - PAD * 2)
  const y = (fraction: number) => PAD + (1 - fraction) * (height - PAD * 3)
  const step = Math.max(1, Math.floor(count / POINTS))
  const price: string[] = []
  for (let bar = 0; bar < count; bar += step) price.push(`${x(bar).toFixed(1)},${y(((close[bar] ?? minimum) - minimum) / span).toFixed(1)}`)
  const clusters: Box[] = run.events.flatMap((event) => {
    if (event.type !== 'trade_cluster') return []
    const left = x(event.region.start_bar) - 6
    const right = x(event.region.end_bar) + 6
    const top = y(event.region.price_high) - 6
    const bottom = y(event.region.price_low) + 6
    return [{ x: left, y: top, width: right - left, height: bottom - top }]
  })
  return { price: price.join(' '), clusters }
}
