import type { Candle, HeatmapMode } from './types'

export const MODE_LABELS: Record<HeatmapMode, string> = {
  FROM_TRADES: 'FROM TRADES',
  ESTIMATED_FROM_CANDLES: 'ESTIMATED FROM CANDLES',
}

function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: value < 10 ? 4 : 2 })
}

function formatVolume(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: value < 100 ? 2 : 0 })
}

export function ohlcText(candle: Candle | undefined): string {
  if (!candle) return '—'
  const time = new Date(candle.time * 1000).toISOString().replace('T', ' ').slice(0, 16)
  return `${time} UTC  O ${formatPrice(candle.open)}  H ${formatPrice(candle.high)}  L ${formatPrice(candle.low)}  C ${formatPrice(candle.close)}  V ${formatVolume(candle.volume)}`
}
