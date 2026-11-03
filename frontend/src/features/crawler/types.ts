import type { CheckStatus, Stage } from '../../api/runEvents'

export type Point = { x: number; y: number }
export type Rect = { left: number; top: number; width: number; height: number }
export type DataPoint = { bar: number; price: number }

export type CrawlerMeasure = {
  stage: { width: number; height: number }
  ports: Point[]
  plot: Rect
}

export type CrawlerLayout = {
  measure: () => CrawlerMeasure | null
  project: (bar: number, price: number) => Point | null
  visiblePriceRange: () => { low: number; high: number } | null
  anchors: () => DataPoint[]
  priceAt: (bar: number) => number | null
  subscribe: (listener: () => void) => () => void
}

export type Pulse = { status: CheckStatus; startedAt: number }

export type WrapRegion = {
  startBar: number
  endBar: number
  priceLow: number
  priceHigh: number
  units: 'fraction' | 'price'
  label: string
}

export type CrawlerHandle = {
  start: (barCount?: number) => void
  setStage: (stage: Stage, progress: number) => void
  setBeam: (bar: number) => void
  wrap: (region: WrapRegion) => void
  pulse: (nodeId: string, status: CheckStatus) => void
  finish: () => void
  fail: (stage: Stage) => void
  reset: () => void
  moveSpiderTo: (point: Point) => void
  setAggression: (level: number) => void
  setTempo: (tempo: number) => void
}
