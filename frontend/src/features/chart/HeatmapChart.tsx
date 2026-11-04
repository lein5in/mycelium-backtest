import {
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { heatRamp, readTheme, withAlpha, type Theme } from '../../theme/tokens'
import { columnCenterBar } from './columns'
import { fractionalBarToX } from './fractionalBar'
import { parseHex } from './heatmapColor'
import { HeatmapPrimitive } from './HeatmapPrimitive'
import { visibleEquity, visiblePrices, visibleTrades } from './replay'
import { strongestCells } from './strongestCells'
import { TradeMarkersPrimitive } from './TradeMarkersPrimitive'
import { MODE_LABELS, ohlcText } from './chartText'
import type { ChartData } from './types'
import { VolumeBarsPrimitive } from './VolumeBarsPrimitive'
import { VolumeProfilePrimitive } from './VolumeProfilePrimitive'

export type PaneRect = { left: number; top: number; width: number; height: number }

export type AnchorPoint = { bar: number; price: number }

export type ChartProjection = {
  barCount: number
  barToX: (bar: number) => number | null
  priceToY: (price: number) => number | null
  yToPrice: (y: number) => number | null
  paneRect: () => PaneRect | null
  anchors: AnchorPoint[]
  container: HTMLElement
  chart: IChartApi
  series: ISeriesApi<'Line'>
}

type HeatmapChartProps = {
  data: ChartData
  sourceMode?: string | null
  showTrades?: boolean
  showPanes?: boolean
  showProfile?: boolean
  cursor?: number | null
  selectedTrade?: number | null
  onReady?: (projection: ChartProjection | null) => void
  label?: string
}

const MAIN_PANE_SHARE = 0.66
const EQUITY_PANE_SHARE = 0.2
const DRAWDOWN_PANE_SHARE = 0.14
const ANCHOR_COUNT = 14

type Handles = {
  chart: IChartApi
  theme: Theme
  price: ISeriesApi<'Line'>
  volume: VolumeBarsPrimitive
  heatmap: HeatmapPrimitive
  profile: VolumeProfilePrimitive
  markers: TradeMarkersPrimitive
  equity: ISeriesApi<'Line'> | null
  withoutBest: ISeriesApi<'Line'> | null
  drawdown: ISeriesApi<'Line'> | null
}

const asTime = (seconds: number) => seconds as UTCTimestamp

export function HeatmapChart({
  data,
  sourceMode = null,
  showTrades = true,
  showPanes = false,
  showProfile = true,
  cursor = null,
  selectedTrade = null,
  onReady,
  label = 'Price chart with volume heatmap',
}: HeatmapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const handlesRef = useRef<Handles | null>(null)
  const onReadyRef = useRef(onReady)
  const cursorRef = useRef(cursor)
  const [paneTops, setPaneTops] = useState<number[]>([])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

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
        panes: { separatorColor: theme.border, separatorHoverColor: theme['border-strong'], enableResize: false },
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
        minBarSpacing: 0.02,
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
    price.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.16 } })


    const heatmap = new HeatmapPrimitive()
    const volume = new VolumeBarsPrimitive(theme)
    const profile = new VolumeProfilePrimitive(theme)
    const markers = new TradeMarkersPrimitive(theme)
    price.attachPrimitive(heatmap)
    price.attachPrimitive(volume)
    volume.setCandles(data.candles)
    price.attachPrimitive(profile)
    price.attachPrimitive(markers)
    const times = data.candles.map((candle) => candle.time)
    heatmap.setGrid(data.grid, times, heatRamp(theme).map(parseHex))
    if (data.profile) profile.setProfile(data.grid, data.profile)

    let equity: ISeriesApi<'Line'> | null = null
    let withoutBest: ISeriesApi<'Line'> | null = null
    let drawdown: ISeriesApi<'Line'> | null = null
    if (showPanes && data.panes) {
      equity = chart.addSeries(
        LineSeries,
        { priceScaleId: 'left', color: theme.accent, lineWidth: 1, lastValueVisible: false, priceLineVisible: false },
        1,
      )
      withoutBest = chart.addSeries(
        LineSeries,
        {
          priceScaleId: 'left',
          color: withAlpha(theme['warn-text'], 0.85),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lastValueVisible: false,
          priceLineVisible: false,
        },
        1,
      )
      drawdown = chart.addSeries(
        LineSeries,
        { priceScaleId: 'left', color: theme['loss-text'], lineWidth: 1, lastValueVisible: false, priceLineVisible: false },
        2,
      )
      chart.panes()[0]?.setStretchFactor(MAIN_PANE_SHARE)
      chart.panes()[1]?.setStretchFactor(EQUITY_PANE_SHARE)
      chart.panes()[2]?.setStretchFactor(DRAWDOWN_PANE_SHARE)
    }

    const handles: Handles = { chart, theme, price, volume, heatmap, profile, markers, equity, withoutBest, drawdown }
    handlesRef.current = handles
    applyCursor(handles, data, cursorRef.current)
    chart.timeScale().fitContent()

    const spans = heatmap.columnSpans()
    const anchors = spans
      ? strongestCells(data.grid, ANCHOR_COUNT, Math.max(1, Math.floor(data.grid.columns / 40))).flatMap((cell) => {
          const bar = columnCenterBar(spans, cell.column)
          return bar === null ? [] : [{ bar, price: cell.price }]
        })
      : []

    const showReadout = (param: MouseEventParams<Time>) => {
      const limit = cursorRef.current ?? data.candles.length - 1
      const logical = param.logical === undefined ? limit : Math.min(limit, Math.max(0, Math.round(param.logical)))
      if (readoutRef.current) readoutRef.current.textContent = ohlcText(data.candles[logical])
    }
    chart.subscribeCrosshairMove(showReadout)
    if (readoutRef.current) readoutRef.current.textContent = ohlcText(data.candles[cursorRef.current ?? data.candles.length - 1])

    let fitted = false
    const measurePanes = () => {
      if (!fitted && container.clientWidth > 0) {
        fitted = true
        chart.timeScale().fitContent()
      }
      const heights = chart.panes().map((pane) => pane.getHeight())
      const tops: number[] = []
      let top = 0
      for (const height of heights) {
        tops.push(top)
        top += height + 1
      }
      setPaneTops(tops)
    }
    const observer = new ResizeObserver(measurePanes)
    observer.observe(container)

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
      anchors,
      container,
      chart,
      series: price,
    }
    onReadyRef.current?.(projection)

    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(showReadout)
      onReadyRef.current?.(null)
      handlesRef.current = null
      chart.remove()
    }
  }, [data, showPanes])

  useEffect(() => {
    const handles = handlesRef.current
    if (!handles) return
    applyCursor(handles, data, cursor)
    handles.profile.setHidden(!showProfile || cursor !== null)
    const range = handles.chart.timeScale().getVisibleLogicalRange()
    if (cursor !== null && range && (cursor > range.to - 2 || cursor < range.from)) {
      const width = range.to - range.from
      handles.chart.timeScale().setVisibleLogicalRange({ from: cursor - width * 0.8, to: cursor + width * 0.2 })
    }
    if (readoutRef.current) readoutRef.current.textContent = ohlcText(data.candles[cursor ?? data.candles.length - 1])
  }, [data, cursor, showProfile])

  useEffect(() => {
    const handles = handlesRef.current
    if (!handles) return
    handles.markers.setTrades(showTrades ? visibleTrades(data.trades, cursor) : [])
  }, [data, showTrades, cursor, showPanes])

  useEffect(() => {
    const handles = handlesRef.current
    if (!handles) return
    handles.markers.setSelected(selectedTrade)
    const trade = data.trades.find((item) => item.id === selectedTrade)
    if (!trade) return
    const end = trade.exitBar ?? trade.entryBar
    const pad = Math.max(24, (end - trade.entryBar) * 1.5)
    handles.chart.timeScale().setVisibleLogicalRange({ from: trade.entryBar - pad, to: end + pad })
  }, [data, selectedTrade, showPanes])

  const panes = showPanes && data.panes
  return (
    <div className="relative h-full w-full" role="img" aria-label={label}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute top-1.5 right-3 left-[72px] z-10 flex flex-wrap items-center gap-1">
        {sourceMode === 'SAMPLE DATA' && (
          <span className="border border-warn bg-app px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-warn-text">
            SAMPLE DATA
          </span>
        )}
        <span
          data-testid="chart-mode"
          className={`border bg-app px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] ${data.grid.mode === 'ESTIMATED_FROM_CANDLES' ? 'border-warn text-warn-text' : 'border-line-strong text-ink-2'}`}
        >
          {MODE_LABELS[data.grid.mode]}
        </span>
        {cursor !== null && (
          <span className="border border-accent bg-app px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-accent-text">
            REPLAY OF THE FINISHED RUN · NOT A RE-EXECUTION
          </span>
        )}
        <span
          ref={readoutRef}
          data-testid="ohlc-readout"
          className="ml-1 truncate bg-app/80 px-1 font-mono text-[11px] whitespace-pre text-ink-2 tabular-nums"
        />
      </div>
      {panes && paneTops.length >= 3 && (
        <>
          <span
            className="pointer-events-none absolute left-[72px] z-10 flex gap-3 font-mono text-[10.5px] tracking-[0.06em] text-ink-3 uppercase"
            style={{ top: (paneTops[1] ?? 0) + 4 }}
          >
            <span className="text-accent-text">Equity · realised at exits</span>
            <span className="text-warn-text">
              - - Without best trade{data.panes?.bestTradeLabel ? ` (${data.panes.bestTradeLabel}, computed here from the trade list)` : ' (no winning trade)'}
            </span>
          </span>
          <span
            className="pointer-events-none absolute left-[72px] z-10 font-mono text-[10.5px] tracking-[0.06em] text-loss-text uppercase"
            style={{ top: (paneTops[2] ?? 0) + 4 }}
          >
            Drawdown % · mark to market, end of session
          </span>
        </>
      )}
    </div>
  )
}

function applyCursor(handles: Handles, data: ChartData, cursor: number | null) {
  const { candles } = data
  handles.price.setData(visiblePrices(candles, cursor).map((point) => ({ ...point, time: asTime(point.time) })))
  handles.volume.setCursor(cursor)
  handles.heatmap.setCursor(cursor)
  const lastIndex = cursor ?? candles.length - 1
  handles.markers.setLastPrice(candles[lastIndex]?.close ?? null, candles[lastIndex - 1]?.close ?? null)
  const panes = data.panes
  if (!panes) return
  const cursorTime = cursor === null ? null : (candles[cursor]?.time ?? null)
  const line = (points: { time: number; value: number }[]) =>
    visibleEquity(points, cursorTime).map((point) => ({ time: asTime(point.time), value: point.value }))
  handles.equity?.setData(line(panes.equity))
  handles.withoutBest?.setData(line(panes.withoutBest))
  handles.drawdown?.setData(line(panes.drawdown))
}
