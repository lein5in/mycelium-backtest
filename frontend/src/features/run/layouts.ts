import type { ChartProjection } from '../chart/HeatmapChart'
import type { Candle } from '../chart/types'
import type { CrawlerLayout, CrawlerMeasure, Rect, WrapRegion } from '../crawler/types'

export type StageRefs = {
  stage: () => HTMLElement | null
  chartBox: () => HTMLElement | null
  cells: () => (HTMLElement | null)[]
}

const LINEAR_INSET = { left: 64, right: 16, top: 12, bottom: 28 }

function measureWith(refs: StageRefs, plotOf: (stageRect: DOMRect, boxRect: DOMRect) => Rect | null) {
  return (): CrawlerMeasure | null => {
    const stage = refs.stage()
    const box = refs.chartBox()
    if (!stage || !box) return null
    const stageRect = stage.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const plot = plotOf(stageRect, boxRect)
    if (!plot || plot.width <= 0 || plot.height <= 0) return null
    const ports = refs.cells().map((cell) => {
      const rect = cell?.getBoundingClientRect()
      return rect ? { x: rect.left - stageRect.left + rect.width / 2, y: rect.bottom - stageRect.top } : { x: 0, y: 0 }
    })
    return { stage: { width: stageRect.width, height: stageRect.height }, ports, plot }
  }
}

export function linearLayout(refs: StageRefs, barCount: number): CrawlerLayout {
  let plot: Rect = { left: 0, top: 0, width: 0, height: 0 }
  const measure = measureWith(refs, (stageRect, boxRect) => {
    plot = {
      left: boxRect.left - stageRect.left + LINEAR_INSET.left,
      top: boxRect.top - stageRect.top + LINEAR_INSET.top,
      width: boxRect.width - LINEAR_INSET.left - LINEAR_INSET.right,
      height: boxRect.height - LINEAR_INSET.top - LINEAR_INSET.bottom,
    }
    return plot
  })
  const span = Math.max(1, barCount - 1)
  return {
    measure,
    project: (bar, price) => ({ x: plot.left + (bar / span) * plot.width, y: plot.top + (1 - price) * plot.height }),
    visiblePriceRange: () => ({ low: 0, high: 1 }),
    anchors: () => [],
    priceAt: () => 0.5,
    subscribe: () => () => undefined,
  }
}

export function chartLayout(refs: StageRefs, projection: ChartProjection, candles: readonly Candle[], firstIndex: number): CrawlerLayout {
  const offset = { left: 0, top: 0 }
  const measure = measureWith(refs, (stageRect, boxRect) => {
    const pane = projection.paneRect()
    if (!pane) return null
    offset.left = boxRect.left - stageRect.left + pane.left
    offset.top = boxRect.top - stageRect.top + pane.top
    return { left: offset.left, top: offset.top, width: pane.width, height: pane.height }
  })
  return {
    measure,
    project: (bar, price) => {
      const x = projection.barToX(bar - firstIndex)
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
    anchors: () => projection.anchors.map((anchor) => ({ bar: anchor.bar + firstIndex, price: anchor.price })),
    priceAt: (bar) => candles[Math.round(bar) - firstIndex]?.close ?? null,
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
}

export function dataRange(candles: readonly Candle[]): { low: number; high: number } | null {
  if (candles.length === 0) return null
  let low = Infinity
  let high = -Infinity
  for (const candle of candles) {
    if (candle.low < low) low = candle.low
    if (candle.high > high) high = candle.high
  }
  return { low, high }
}

export function regionInPrices(region: WrapRegion, range: { low: number; high: number } | null): WrapRegion {
  if (region.units !== 'fraction' || !range) return region
  const span = range.high - range.low
  return {
    ...region,
    units: 'price',
    priceLow: range.low + span * region.priceLow,
    priceHigh: range.low + span * region.priceHigh,
  }
}
