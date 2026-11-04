import type { EquityPoint } from './types'

export type EquityTrade = { exitTime: number; netPnl: number }

export function realisedEquity(
  trades: readonly EquityTrade[],
  startTime: number,
  startEquity: number,
  skip: number | null = null,
): EquityPoint[] {
  const points: EquityPoint[] = [{ time: startTime, value: startEquity }]
  let equity = startEquity
  trades.forEach((trade, index) => {
    if (index !== skip) equity += trade.netPnl
    const previous = points.at(-1)
    if (previous && previous.time === trade.exitTime) previous.value = equity
    else points.push({ time: trade.exitTime, value: equity })
  })
  return points
}

export function bestTradeIndex(trades: readonly EquityTrade[]): number | null {
  let best: number | null = null
  trades.forEach((trade, index) => {
    if (trade.netPnl <= 0) return
    if (best === null || trade.netPnl > (trades[best]?.netPnl ?? -Infinity)) best = index
  })
  return best
}

export function withoutBestTrade(trades: readonly EquityTrade[], startTime: number, startEquity: number): EquityPoint[] {
  return realisedEquity(trades, startTime, startEquity, bestTradeIndex(trades))
}

export function drawdownPercent(points: readonly EquityPoint[]): EquityPoint[] {
  let peak = -Infinity
  return points.map((point) => {
    peak = Math.max(peak, point.value)
    return { time: point.time, value: peak > 0 ? ((point.value - peak) / peak) * 100 : 0 }
  })
}
