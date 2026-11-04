import { mulberry32 } from '../../lib/random'
import { cellIndex, type Candle, type ChartData, type HeatmapGrid, type SampleData, type SampleTrade } from './types'
import { buildVolumeProfile } from './volumeProfile'

type SampleOptions = {
  seed: number
  bars: number
  rows: number
  barSeconds: number
  startTime: number
}

export const defaultSampleOptions: SampleOptions = {
  seed: 7,
  bars: 400,
  rows: 120,
  barSeconds: 900,
  startTime: Date.UTC(2026, 0, 5) / 1000,
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

function generateCandles(random: () => number, options: SampleOptions): Candle[] {
  const candles: Candle[] = []
  let price = 100
  let volatility = 0.0035
  for (let index = 0; index < options.bars; index += 1) {
    volatility = Math.min(0.012, Math.max(0.0015, volatility * (1 + 0.25 * gaussian(random) * 0.3)))
    const drift = Math.sin(index / 55) * 0.0009
    const open = price
    const close = open * (1 + drift + volatility * gaussian(random))
    const wick = open * volatility * 0.8
    const high = Math.max(open, close) + Math.abs(gaussian(random)) * wick
    const low = Math.min(open, close) - Math.abs(gaussian(random)) * wick
    const burst = random() < 0.06 ? 3 + random() * 4 : 1
    const volume = Math.round((800 + 2400 * random()) * burst * (1 + volatility * 120))
    candles.push({ time: options.startTime + index * options.barSeconds, open, high, low, close, volume })
    price = close
  }
  return candles
}

export function estimateGridFromCandles(candles: Candle[], rows: number, barSeconds: number): HeatmapGrid {
  const lowest = Math.min(...candles.map((c) => c.low))
  const highest = Math.max(...candles.map((c) => c.high))
  const bucket = (highest - lowest) / rows
  const volumes = new Array<number>(candles.length * rows).fill(0)
  const buyRatio = new Array<number>(candles.length * rows).fill(0.5)
  const grid: HeatmapGrid = {
    mode: 'ESTIMATED_FROM_CANDLES',
    time_bucket_seconds: barSeconds,
    price_bucket: bucket,
    columns: candles.length,
    rows,
    first_time: candles[0]?.time ?? 0,
    lowest_price: lowest,
    intensity: volumes,
    buy_ratio: buyRatio,
  }
  candles.forEach((candle, column) => {
    const typical = (candle.high + candle.low + candle.close) / 3
    const range = Math.max(candle.high - candle.low, bucket)
    const firstRow = Math.max(0, Math.floor((candle.low - lowest) / bucket))
    const lastRow = Math.max(
      firstRow,
      Math.min(rows - 1, Math.ceil((candle.high - lowest) / bucket) - 1),
    )
    const ratio = (candle.close - candle.low) / range
    let weightSum = 0
    const weights: number[] = []
    for (let row = firstRow; row <= lastRow; row += 1) {
      const centre = lowest + (row + 0.5) * bucket
      const weight = Math.max(0.05, 1 - Math.abs(centre - typical) / range)
      weights.push(weight)
      weightSum += weight
    }
    weights.forEach((weight, offset) => {
      const index = cellIndex(grid, column, firstRow + offset)
      volumes[index] = (candle.volume * weight) / weightSum
      buyRatio[index] = Math.min(1, Math.max(0, ratio))
    })
  })
  const peak = volumes.reduce((max, value) => (value > max ? value : max), 0)
  grid.intensity = volumes.map((value) => (peak > 0 ? value / peak : 0))
  return grid
}

function pickTrades(random: () => number, candles: Candle[]): SampleTrade[] {
  const trades: SampleTrade[] = []
  let bar = 20
  while (bar < candles.length - 16) {
    const hold = 4 + Math.floor(random() * 10)
    const entry = candles[bar + 1]
    const exit = candles[bar + 1 + hold]
    const signal = candles[bar]
    const lookback = candles[bar - 8]
    if (!entry || !exit || !signal || !lookback) break
    const side = signal.close >= lookback.close ? 'long' : 'short'
    const direction = side === 'long' ? 1 : -1
    const pnl = Math.round((exit.open - entry.open) * direction * 100 * 100) / 100
    trades.push({
      side,
      entryBar: bar + 1,
      entryPrice: entry.open,
      exitBar: bar + 1 + hold,
      exitPrice: exit.open,
      pnl,
    })
    bar += hold + 8 + Math.floor(random() * 14)
  }
  return trades
}

export function generateSampleData(options: SampleOptions = defaultSampleOptions): SampleData {
  const random = mulberry32(options.seed)
  const candles = generateCandles(random, options)
  const grid = estimateGridFromCandles(candles, options.rows, options.barSeconds)
  const trades = pickTrades(random, candles)
  return { candles, grid, trades }
}

export function chartDataFromSample(sample: SampleData): ChartData {
  const profile = buildVolumeProfile(sample.grid, 0, sample.grid.columns - 1)
  return {
    candles: sample.candles,
    grid: sample.grid,
    trades: sample.trades.map((trade, id) => ({ ...trade, id })),
    profile: {
      buy: profile.rows.map((row) => row.buy),
      sell: profile.rows.map((row) => row.sell),
      pocRow: profile.pocRow >= 0 ? profile.pocRow : null,
    },
  }
}
