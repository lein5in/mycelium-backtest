export type CrawlerParams = {
  spiderScale: number
  legReach: number
  stepThreshold: number
  spiderSpeed: number
  nodeCount: number
  linkDistance: number
  rebuildInterval: number
  driftSpeed: number
  glowBlur: number
  spiralTurns: number
}

export type ParamSpec = { label: string; min: number; max: number; step: number; unit: string }

export const PARAM_SPECS: Record<keyof CrawlerParams, ParamSpec> = {
  spiderScale: { label: 'Spider scale', min: 0.6, max: 1.8, step: 0.05, unit: '×' },
  legReach: { label: 'Leg reach', min: 1.6, max: 3.4, step: 0.05, unit: 'body' },
  stepThreshold: { label: 'Step threshold', min: 0.2, max: 1.2, step: 0.05, unit: 'body' },
  spiderSpeed: { label: 'Spider speed', min: 60, max: 400, step: 10, unit: 'px/s' },
  nodeCount: { label: 'Node count', min: 45, max: 70, step: 1, unit: '' },
  linkDistance: { label: 'Link distance', min: 80, max: 200, step: 5, unit: 'px' },
  rebuildInterval: { label: 'Rebuild interval', min: 700, max: 1200, step: 10, unit: 'ms' },
  driftSpeed: { label: 'Drift speed', min: 0, max: 12, step: 0.5, unit: 'px/s' },
  glowBlur: { label: 'Glow blur', min: 0, max: 16, step: 0.5, unit: 'px' },
  spiralTurns: { label: 'Spiral turns', min: 2, max: 3, step: 0.1, unit: '' },
}

export const DEFAULT_PARAMS: CrawlerParams = {
  spiderScale: 1,
  legReach: 2.3,
  stepThreshold: 0.55,
  spiderSpeed: 220,
  nodeCount: 64,
  linkDistance: 140,
  rebuildInterval: 950,
  driftSpeed: 2.5,
  glowBlur: 6,
  spiralTurns: 2.5,
}

export const BODY_LENGTH_1X = 24
export const REBUILD_JITTER = 0.25
export const MAX_NODES = 90
export const MAX_LINKS = 120
export const MIN_ACTIVE_LINKS = 60
export const MAX_ACTIVE_LINKS = 80
export const MIN_LINK_ALPHA = 0.25
export const MAX_LINK_ALPHA = 0.7
export const REFERENCE_PLOT_AREA = 1000 * 650

export function clampParams(input: Partial<CrawlerParams>): CrawlerParams {
  const merged = { ...DEFAULT_PARAMS, ...input }
  const entries = (Object.keys(PARAM_SPECS) as (keyof CrawlerParams)[]).map((key) => {
    const spec = PARAM_SPECS[key]
    const value = Number.isFinite(merged[key]) ? merged[key] : DEFAULT_PARAMS[key]
    return [key, Math.min(spec.max, Math.max(spec.min, value))]
  })
  return Object.fromEntries(entries) as CrawlerParams
}

export function bodyLength(params: CrawlerParams): number {
  return BODY_LENGTH_1X * params.spiderScale
}

export function nextRebuildDelay(params: CrawlerParams, random: () => number): number {
  const spread = params.rebuildInterval * REBUILD_JITTER
  const value = params.rebuildInterval - spread + random() * spread * 2
  return Math.min(1200, Math.max(700, value))
}
