import type { Candle, ChartTrade, EquityPoint } from './types'

export type PricePoint = { time: number; value?: number; color?: string }

export function visiblePrices(candles: readonly Candle[], cursor: number | null): PricePoint[] {
  return candles.map((candle, index) =>
    cursor === null || index <= cursor ? { time: candle.time, value: candle.close } : { time: candle.time },
  )
}

export function visibleTrades(trades: readonly ChartTrade[], cursor: number | null): ChartTrade[] {
  if (cursor === null) return [...trades]
  return trades.flatMap((trade) => {
    if (trade.entryBar > cursor) return []
    if (trade.exitBar !== null && trade.exitBar <= cursor) return [trade]
    return [{ ...trade, exitBar: null, exitPrice: null, pnl: null }]
  })
}

export function visibleEquity(points: readonly EquityPoint[], cursorTime: number | null): EquityPoint[] {
  if (cursorTime === null) return [...points]
  return points.filter((point) => point.time <= cursorTime)
}

export const REPLAY_SPEEDS = [1, 4, 16, 64] as const
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]

export function clampCursor(cursor: number, barCount: number): number {
  return Math.min(Math.max(0, Math.round(cursor)), Math.max(0, barCount - 1))
}

export function advanceCursor(cursor: number, elapsedMs: number, speed: number, barCount: number): number {
  const barsPerSecond = 8 * speed
  return Math.min(barCount - 1, cursor + (elapsedMs / 1000) * barsPerSecond)
}
