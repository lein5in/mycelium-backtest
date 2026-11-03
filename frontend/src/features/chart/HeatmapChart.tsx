import {
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { heatRamp, readTheme, withAlpha } from '../../theme/tokens'
import { fractionalBarToX } from './fractionalBar'
import { parseHex } from './heatmapColor'
import { HeatmapPrimitive } from './HeatmapPrimitive'
import { strongestCells, type StrongCell } from './strongestCells'
import { TradeMarkersPrimitive } from './TradeMarkersPrimitive'
import type { HeatmapMode, SampleData } from './types'
import { VolumeProfilePrimitive } from './VolumeProfilePrimitive'

export type PaneRect = { left: number; top: number; width: number; height: number }

export type ChartProjection = {
  barCount: number
  barToX: (bar: number) => number | null
  priceToY: (price: number) => number | null
  yToPrice: (y: number) => number | null
  paneRect: () => PaneRect | null
  anchors: StrongCell[]
  container: HTMLElement
  chart: IChartApi
  series: ISeriesApi<'Line'>
}

type HeatmapChartProps = {
  data: SampleData
  showTrades?: boolean
  sampleLabel?: boolean
  onReady?: (projection: ChartProjection | null) => void
}

const modeLabels: Record<HeatmapMode, string> = {
  FROM_TRADES: 'FROM TRADES',
  ESTIMATED_FROM_CANDLES: 'ESTIMATED FROM CANDLES',
}

export function HeatmapChart({ data, showTrades = true, sampleLabel = true, onReady }: HeatmapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const theme = readTheme()
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: theme['bg-app'] },
        textColor: theme['text-3'],
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: theme.grid, style: LineStyle.Dotted },
        horzLines: { visible: false },
      },
      leftPriceScale: { visible: true, borderColor: theme.border },
      rightPriceScale: { visible: false },
      timeScale: {
        borderColor: theme.border,
        timeVisible: true,
        rightOffset: 18,
        barSpacing: 3,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme['border-strong'], labelBackgroundColor: theme['bg-panel-head'] },
        horzLine: { color: theme['border-strong'], labelBackgroundColor: theme['bg-panel-head'] },
      },
    })

    const price = chart.addSeries(LineSeries, {
      priceScaleId: 'left',
      color: withAlpha(theme['price-line'], 0.8),
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    })
    price.setData(
      data.candles.map((candle) => ({ time: candle.time as UTCTimestamp, value: candle.close })),
    )
    price.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.16 } })

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: 'volume' },
    })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } })
    volume.setData(
      data.candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: withAlpha(candle.close >= candle.open ? theme.profit : theme.loss, 0.45),
      })),
    )

    const ramp = heatRamp(theme).map(parseHex)
    const heatmap = new HeatmapPrimitive()
    const profile = new VolumeProfilePrimitive(theme)
    const markers = new TradeMarkersPrimitive(theme)
    price.attachPrimitive(heatmap)
    price.attachPrimitive(profile)
    price.attachPrimitive(markers)
    heatmap.setGrid(data.grid, 0, ramp)
    profile.setGrid(data.grid, 0)
    if (showTrades) markers.setTrades(data.trades, 0)
    const last = data.candles.at(-1)
    const previous = data.candles.at(-2)
    if (last && previous) markers.setLastPrice(last.close, previous.close)
    chart.timeScale().fitContent()

    const projection: ChartProjection = {
      barCount: data.candles.length,
      barToX: (bar) => fractionalBarToX((whole) => chart.timeScale().logicalToCoordinate(whole as Logical), bar),
      priceToY: (value) => price.priceToCoordinate(value),
      yToPrice: (y) => price.coordinateToPrice(y),
      paneRect: () => {
        const size = chart.paneSize(0)
        if (size.width <= 0 || size.height <= 0) return null
        return { left: chart.priceScale('left').width(), top: 0, width: size.width, height: size.height }
      },
      anchors: strongestCells(data.grid, 14, 18),
      container,
      chart,
      series: price,
    }
    onReadyRef.current?.(projection)

    return () => {
      onReadyRef.current?.(null)
      chart.remove()
    }
  }, [data, showTrades])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute top-2 left-[72px] z-10 flex gap-1">
        {sampleLabel && (
          <span className="border border-warn bg-app px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-warn-text">
            SAMPLE DATA
          </span>
        )}
        <span className="border border-line-strong bg-app px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-ink-2">
          {modeLabels[data.grid.mode]}
        </span>
      </div>
    </div>
  )
}
