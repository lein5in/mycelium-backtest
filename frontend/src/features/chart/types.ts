export type HeatmapMode = 'FROM_TRADES' | 'ESTIMATED_FROM_CANDLES'

export type HeatmapGrid = {
  mode: HeatmapMode
  time_bucket_seconds: number
  price_bucket: number
  columns: number
  rows: number
  first_time: number
  lowest_price: number
  intensity: number[]
  buy_ratio: number[]
}

export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type SampleTrade = {
  side: 'long' | 'short'
  entryBar: number
  entryPrice: number
  exitBar: number
  exitPrice: number
  pnl: number
}

export type ChartTrade = {
  id?: number
  side: 'long' | 'short'
  entryBar: number
  entryPrice: number
  exitBar: number | null
  exitPrice: number | null
  pnl: number | null
}

export type ChartProfile = { buy: number[]; sell: number[]; pocRow: number | null }

export type EquityPoint = { time: number; value: number }

export type EquityPanes = {
  equity: EquityPoint[]
  withoutBest: EquityPoint[]
  drawdown: EquityPoint[]
  bestTradeLabel: string | null
}

export type ChartData = {
  candles: Candle[]
  grid: HeatmapGrid
  trades: ChartTrade[]
  profile?: ChartProfile
  panes?: EquityPanes
}

export type SampleData = {
  candles: Candle[]
  grid: HeatmapGrid
  trades: SampleTrade[]
}

export const cellIndex = (grid: HeatmapGrid, column: number, row: number) =>
  column * grid.rows + row
