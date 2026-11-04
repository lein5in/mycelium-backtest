import { describe, expect, it } from 'vitest'
import { columnCenterBar, columnSpans, completedColumns } from './columns'
import { bestTradeIndex, drawdownPercent, realisedEquity, withoutBestTrade } from './equity'
import { advanceCursor, clampCursor, visibleEquity, visiblePrices, visibleTrades } from './replay'
import { volumeColumns } from './VolumeBarsPrimitive'
import { anchorMinutes, lastBarOfSessions } from './sessions'
import type { Candle, ChartTrade, HeatmapGrid } from './types'

function grid(columns: number, bucket: number, first = 0): HeatmapGrid {
  return {
    mode: 'ESTIMATED_FROM_CANDLES',
    time_bucket_seconds: bucket,
    price_bucket: 1,
    columns,
    rows: 2,
    first_time: first,
    lowest_price: 0,
    intensity: new Array(columns * 2).fill(0.5),
    buy_ratio: new Array(columns * 2).fill(0.5),
  }
}

describe('column spans', () => {
  it('maps each column to the bars inside its time bucket, leaving night columns empty', () => {
    const times = [0, 300, 600, 1_200, 4_000, 4_300]
    const spans = columnSpans(grid(4, 1_200), times)
    expect(Array.from(spans.first)).toEqual([0, 3, -1, 4])
    expect(Array.from(spans.last)).toEqual([2, 3, -1, 5])
    expect(spans.uniform).toBe(false)
    expect(columnCenterBar(spans, 0)).toBe(1)
    expect(columnCenterBar(spans, 2)).toBeNull()
  })

  it('detects one column per bar so the whole grid can be drawn at once', () => {
    const spans = columnSpans(grid(3, 300), [0, 300, 600])
    expect(spans.uniform).toBe(true)
  })

  it('only counts columns whose every bar is at or before the replay cursor', () => {
    const spans = columnSpans(grid(4, 1_200), [0, 300, 600, 1_200, 4_000, 4_300])
    expect(completedColumns(spans, null)).toBe(4)
    expect(completedColumns(spans, 1)).toBe(0)
    expect(completedColumns(spans, 2)).toBe(1)
    expect(completedColumns(spans, 4)).toBe(2)
    expect(completedColumns(spans, 5)).toBe(4)
  })
})

describe('equity from the trade list', () => {
  const trades = [
    { exitTime: 10, netPnl: 50 },
    { exitTime: 20, netPnl: 300 },
    { exitTime: 30, netPnl: -80 },
    { exitTime: 30, netPnl: 20 },
  ]

  it('steps the realised equity at each exit and merges exits at the same time', () => {
    expect(realisedEquity(trades, 0, 1_000)).toEqual([
      { time: 0, value: 1_000 },
      { time: 10, value: 1_050 },
      { time: 20, value: 1_350 },
      { time: 30, value: 1_290 },
    ])
  })

  it('removes only the best trade for the without-best-trade line', () => {
    expect(bestTradeIndex(trades)).toBe(1)
    expect(withoutBestTrade(trades, 0, 1_000)).toEqual([
      { time: 0, value: 1_000 },
      { time: 10, value: 1_050 },
      { time: 20, value: 1_050 },
      { time: 30, value: 990 },
    ])
  })

  it('has no best trade to remove when nothing won', () => {
    const losers = [{ exitTime: 5, netPnl: -10 }]
    expect(bestTradeIndex(losers)).toBeNull()
    expect(withoutBestTrade(losers, 0, 100)).toEqual(realisedEquity(losers, 0, 100))
  })

  it('computes drawdown from the running peak', () => {
    const points = drawdownPercent([
      { time: 0, value: 100 },
      { time: 1, value: 120 },
      { time: 2, value: 90 },
    ])
    expect(points.map((point) => point.value)).toEqual([0, 0, -25])
  })
})

describe('replay never shows the future', () => {
  const candles: Candle[] = Array.from({ length: 10 }, (_, index) => ({
    time: index * 60,
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 10.5 + index,
    volume: 100 + index,
  }))
  const trades: ChartTrade[] = [
    { id: 0, side: 'long', entryBar: 1, entryPrice: 11, exitBar: 3, exitPrice: 13, pnl: 20 },
    { id: 1, side: 'short', entryBar: 4, entryPrice: 14, exitBar: 8, exitPrice: 12, pnl: 18 },
    { id: 2, side: 'long', entryBar: 9, entryPrice: 19, exitBar: 9, exitPrice: 19.5, pnl: 5 },
  ]

  it('keeps the bar count but blanks every price and volume after the cursor', () => {
    for (const cursor of [0, 3, 6, 9]) {
      const prices = visiblePrices(candles, cursor)
      expect(prices).toHaveLength(candles.length)
      prices.forEach((point, index) => expect(point.value !== undefined).toBe(index <= cursor))
    }
  })

  it('shows closed trades, hides the outcome of an open trade and omits future entries', () => {
    const visible = visibleTrades(trades, 5)
    expect(visible.map((trade) => trade.id)).toEqual([0, 1])
    expect(visible[0]).toEqual(trades[0])
    expect(visible[1]).toMatchObject({ id: 1, exitBar: null, exitPrice: null, pnl: null })
    expect(visibleTrades(trades, null)).toEqual(trades)
  })

  it('draws one volume column per bar when bars are wide, and one per pixel when they are dense', () => {
    const wide = volumeColumns(candles, 0, 3, 100, 10)
    expect(wide.map((column) => column.volume)).toEqual([100, 101, 102, 103])
    expect(wide[1]?.left).toBeCloseTo(106.5)
    const dense = volumeColumns(candles, 0, 9, 0, 0.25)
    expect(dense).toHaveLength(3)
    expect(dense.map((column) => column.volume)).toEqual([103, 107, 109])
    expect(dense.every((column) => column.width === 1)).toBe(true)
  })

  it('cuts the equity pane at the cursor time', () => {
    const points = [
      { time: 0, value: 1 },
      { time: 120, value: 2 },
      { time: 300, value: 3 },
    ]
    expect(visibleEquity(points, 180)).toEqual(points.slice(0, 2))
    expect(visibleEquity(points, null)).toEqual(points)
  })

  it('advances and clamps the cursor inside the bars', () => {
    expect(clampCursor(-3, 10)).toBe(0)
    expect(clampCursor(12.4, 10)).toBe(9)
    expect(advanceCursor(2, 1_000, 1, 10)).toBe(9)
    expect(advanceCursor(0, 250, 1, 100)).toBe(2)
  })
})

describe('session dates', () => {
  it('reads the anchor', () => {
    expect(anchorMinutes('17:30')).toBe(1_050)
    expect(anchorMinutes(null)).toBe(0)
  })

  it('finds the last bar of each New York session', () => {
    const open = Date.UTC(2024, 0, 2, 14, 30) / 1000
    const times = [open, open + 300, open + 23_100, open + 86_400]
    const ends = lastBarOfSessions(times, 'America/New_York', null)
    expect(ends.get('2024-01-02')).toBe(open + 23_100)
    expect(ends.get('2024-01-03')).toBe(open + 86_400)
  })

  it('shifts crypto sessions by the anchor', () => {
    const base = Date.UTC(2024, 0, 2, 16, 0) / 1000
    const ends = lastBarOfSessions([base, base + 7_200], 'UTC', '17:00')
    expect(ends.get('2024-01-01')).toBe(base)
    expect(ends.get('2024-01-02')).toBe(base + 7_200)
  })
})
