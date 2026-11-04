import type { RunResultPayload, TradeRow } from '../../api/result'
import { bestTradeIndex, realisedEquity, withoutBestTrade, type EquityTrade } from './equity'
import { lastBarOfSessions } from './sessions'
import type { Candle, ChartData, ChartTrade, EquityPanes, EquityPoint } from './types'

export function candlesOf(payload: RunResultPayload): Candle[] {
  const { time, open, high, low, close, volume } = payload.bars
  return time.map((value, index) => ({
    time: value,
    open: open[index] ?? 0,
    high: high[index] ?? 0,
    low: low[index] ?? 0,
    close: close[index] ?? 0,
    volume: volume[index] ?? 0,
  }))
}

export function chartTrades(trades: readonly TradeRow[], firstIndex: number): ChartTrade[] {
  return trades.map((trade, index) => ({
    id: index,
    side: trade.side,
    entryBar: trade.entry_index - firstIndex,
    entryPrice: trade.entry_price,
    exitBar: trade.exit_index - firstIndex,
    exitPrice: trade.exit_price,
    pnl: trade.net_pnl,
  }))
}

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000)

export function equityPanes(payload: RunResultPayload): EquityPanes {
  const { result, limits, report, request } = payload
  const metrics = result.metrics
  const trades: EquityTrade[] = result.trades.map((trade) => ({ exitTime: seconds(trade.exit_time), netPnl: trade.net_pnl }))
  const returned = trades.reduce((sum, trade) => sum + trade.netPnl, 0)
  const startEquity = metrics.initial_capital + metrics.summary.net_pnl - returned
  const startTime = payload.bars.time[0] ?? seconds(result.first_bar)
  const best = bestTradeIndex(trades)
  const bestTrade = best === null ? null : result.trades[best]
  const sessionEnds = lastBarOfSessions(payload.bars.time, report.calendar.timezone, request.session_anchor)
  const drawdown = result.daily_equity.flatMap((day) => {
    const time = sessionEnds.get(day.session)
    return time === undefined ? [] : [{ time, value: -day.drawdown_pct }]
  })
  const barTimes = new Set(payload.bars.time)
  const onBars = (points: EquityPoint[]) => points.filter((point) => barTimes.has(point.time))
  return {
    equity: onBars(realisedEquity(trades, startTime, startEquity)),
    withoutBest: onBars(withoutBestTrade(trades, startTime, startEquity)),
    drawdown,
    bestTradeLabel:
      bestTrade && best !== null
        ? `best trade #${best + 1 + (limits.trades_total - limits.trades_returned)} removed`
        : null,
  }
}

export function chartDataFromResult(payload: RunResultPayload): ChartData {
  const heatmap = payload.heatmap
  return {
    candles: candlesOf(payload),
    grid: heatmap,
    trades: chartTrades(payload.result.trades, payload.limits.bars_first_index),
    profile: { buy: heatmap.profile_buy, sell: heatmap.profile_sell, pocRow: heatmap.poc_row },
    panes: equityPanes(payload),
  }
}
