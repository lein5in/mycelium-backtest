import type { Candle } from '../chart/types'
import type { WrapRegion } from './types'

export function snapRegionToCandles(region: WrapRegion, candles: readonly Candle[]): WrapRegion {
  const first = Math.max(0, Math.floor(Math.min(region.startBar, region.endBar)))
  const last = Math.min(candles.length - 1, Math.ceil(Math.max(region.startBar, region.endBar)))
  const inside = candles.slice(first, last + 1)
  if (inside.length === 0) return region
  return {
    ...region,
    units: 'price',
    priceLow: Math.min(...inside.map((candle) => candle.low)),
    priceHigh: Math.max(...inside.map((candle) => candle.high)),
  }
}
