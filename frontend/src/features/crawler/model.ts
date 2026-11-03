import { CHECK_IDS, STAGES, type CheckStatus, type Stage } from '../../api/runEvents'
import { mulberry32, type Random } from '../../lib/random'
import { legSet } from './gait'
import {
  bodyLength,
  clampParams,
  DEFAULT_PARAMS,
  MAX_NODES,
  nextRebuildDelay,
  type CrawlerParams,
} from './params'
import {
  applyTuning,
  createSpider,
  isArrived,
  moveBody,
  stepLegs,
  type Spider,
  type SpiderTuning,
} from './spider'
import type { CrawlerMeasure, DataPoint, Point } from './types'
import {
  activeLinkTarget,
  applyLinks,
  chooseLinks,
  driftAmbient,
  fadeLinks,
  makeNode,
  scaledThreshold,
  seedAmbient,
  type WebLink,
  type WebNode,
} from './web'

export const MAX_ANCHORS = 12
export const WRAP_MS = 1500
export const RELEASE_MS = 700
export const APPROACH_LIMIT_MS = 2600
export const LASSO_HOLD_MS = 4000
export const LASSO_FADE_MS = 800
export const TAP_REACH_MS = 200
export const TAP_RETURN_MS = 220
export const TAP_APPROACH_LIMIT_MS = 900
export const RETRACT_MS = 1200
export const CLUSTER_HUB = 'cluster:hub'

export type Phase = 'idle' | 'running' | 'done' | 'failed'
export type StageState = 'wait' | 'run' | 'done' | 'fail'
export type StageStatus = { state: StageState; progress: number }

export type Lasso = {
  startBar: number
  endBar: number
  lowPrice: number
  highPrice: number
  label: string
  createdAt: number
  closedAt: number | null
}

export type WrapJob = {
  lasso: Lasso
  phase: 'approach' | 'wrapping' | 'releasing'
  phaseStartedAt: number
  progress: number
  release: number
  approachDirection: Point | null
}

export type TapJob = {
  nodeId: string
  status: CheckStatus
  legIndex: number
  phase: 'approach' | 'reach' | 'return'
  phaseStartedAt: number
}

export type Goal =
  | { kind: 'data'; bar: number }
  | { kind: 'stage'; point: Point }
  | { kind: 'checks' }
  | { kind: 'hold' }

export type CrawlerModel = {
  seed: number
  random: Random
  params: CrawlerParams
  reducedMotion: boolean
  phase: Phase
  stages: Record<Stage, StageStatus>
  barCount: number
  beamBar: number | null
  dragStage: Stage | null
  nodes: WebNode[]
  links: Map<string, WebLink>
  spider: Spider | null
  spawnPending: boolean
  goal: Goal | null
  wrap: WrapJob | null
  lasso: Lasso | null
  tap: TapJob | null
  failedStage: Stage | null
  failedAt: number
  nextRebuildAt: number
  tempo: number
  aggression: number
}

export type FrameInput = {
  measure: CrawlerMeasure
  project: (bar: number, price: number) => Point | null
  priceAt: (bar: number) => number | null
  now: number
  dt: number
}

export const checkNodeId = (checkId: string) => `check:${checkId}`

function freshStages(): Record<Stage, StageStatus> {
  return Object.fromEntries(STAGES.map((stage) => [stage, { state: 'wait', progress: 0 }])) as Record<
    Stage,
    StageStatus
  >
}

function ambientBudget(params: CrawlerParams): number {
  return Math.max(0, Math.min(params.nodeCount, MAX_NODES - CHECK_IDS.length - MAX_ANCHORS - 1))
}

export function createModel(
  seed: number,
  reducedMotion: boolean,
  params: Partial<CrawlerParams> = DEFAULT_PARAMS,
): CrawlerModel {
  const tuned = clampParams(params)
  const hub = makeNode(CLUSTER_HUB, 'cluster', 2.6)
  return {
    seed,
    random: mulberry32(seed ^ 0x5bd1e995),
    params: tuned,
    reducedMotion,
    phase: 'idle',
    stages: freshStages(),
    barCount: 400,
    beamBar: null,
    dragStage: null,
    nodes: [
      ...CHECK_IDS.map((id) => makeNode(checkNodeId(id), 'check', 2.4)),
      hub,
      ...seedAmbient(seed, ambientBudget(tuned)),
    ],
    links: new Map(),
    spider: null,
    spawnPending: false,
    goal: null,
    wrap: null,
    lasso: null,
    tap: null,
    failedStage: null,
    failedAt: 0,
    nextRebuildAt: 0,
    tempo: 1,
    aggression: 0.5,
  }
}

export function spiderTuning(params: CrawlerParams): SpiderTuning {
  return {
    length: bodyLength(params),
    reach: params.legReach,
    stepThreshold: params.stepThreshold,
    speed: params.spiderSpeed,
  }
}

export function setParams(model: CrawlerModel, params: Partial<CrawlerParams>): void {
  const tuned = clampParams({ ...model.params, ...params })
  const countChanged = ambientBudget(tuned) !== ambientBudget(model.params)
  model.params = tuned
  if (countChanged) {
    model.nodes = [
      ...model.nodes.filter((node) => node.kind !== 'ambient'),
      ...seedAmbient(model.seed, ambientBudget(tuned)),
    ]
  }
  if (model.spider) applyTuning(model.spider, spiderTuning(tuned))
  model.nextRebuildAt = 0
}

export function setAnchors(model: CrawlerModel, anchors: DataPoint[]): void {
  model.nodes = model.nodes.filter((node) => node.kind !== 'anchor')
  anchors.slice(0, MAX_ANCHORS).forEach((point, index) => {
    const node = makeNode(`anchor:${index}`, 'anchor', 2.1)
    node.data = point
    model.nodes.push(node)
  })
}

export function nodeCount(model: CrawlerModel): number {
  return model.nodes.length
}

export function startRun(model: CrawlerModel, barCount?: number): void {
  model.phase = 'running'
  if (barCount && barCount > 0) model.barCount = barCount
  model.dragStage = 'DATA'
  model.spider = null
  model.spawnPending = true
  model.goal = null
  model.nextRebuildAt = 0
}

export function spawnSpider(model: CrawlerModel): void {
  model.spider = null
  model.spawnPending = true
  model.dragStage = 'DATA'
  model.goal = null
  model.nextRebuildAt = 0
}

const SWEEP_STAGES: readonly Stage[] = ['DATA', 'SIGNALS', 'SIMULATOR']

export function setStageProgress(model: CrawlerModel, stage: Stage, progress: number): void {
  const status = model.stages[stage]
  if (status.state === 'fail' || status.state === 'done') return
  if (model.phase === 'idle') model.phase = 'running'
  const starting = status.state === 'wait'
  const clamped = Math.max(status.progress, Math.min(100, Math.max(0, progress)))
  status.progress = clamped
  status.state = clamped >= 100 ? 'done' : 'run'
  if (starting) {
    model.dragStage = stage
    if (SWEEP_STAGES.includes(stage)) model.beamBar = 0
    if (stage === 'AUDITOR') model.goal = { kind: 'checks' }
    if (stage === 'COSTS' || stage === 'REPORTER') model.beamBar = null
  }
  if (SWEEP_STAGES.includes(stage) && stage !== 'SIMULATOR' && status.state === 'run') {
    const bar = (clamped / 100) * (model.barCount - 1)
    model.beamBar = bar
    model.goal = { kind: 'data', bar }
  }
  if (stage === 'SIMULATOR' && status.state === 'run' && starting) model.goal = { kind: 'data', bar: 0 }
}

export function setBeam(model: CrawlerModel, bar: number): void {
  if (model.stages.SIMULATOR.state !== 'run') return
  model.beamBar = model.beamBar === null ? bar : Math.max(model.beamBar, bar)
  model.goal = { kind: 'data', bar: model.beamBar }
}

function settleWrap(model: CrawlerModel, now: number): void {
  const job = model.wrap
  if (!job) return
  if (job.lasso.closedAt === null) job.lasso.closedAt = now
  model.lasso = job.lasso
  model.wrap = null
  clearOverrides(model)
  if (model.spider && (model.spider.state === 'wrapping' || model.spider.state === 'releasing')) {
    model.spider.state = 'idle'
  }
}

function clearOverrides(model: CrawlerModel): void {
  for (const leg of model.spider?.legs ?? []) leg.override = null
}

export function wrapRegion(
  model: CrawlerModel,
  region: { startBar: number; endBar: number; lowPrice: number; highPrice: number; label: string },
  now: number,
): void {
  settleWrap(model, now)
  const lasso: Lasso = { ...region, createdAt: now, closedAt: null }
  const hub = model.nodes.find((node) => node.id === CLUSTER_HUB)
  if (hub) {
    hub.data = { bar: (region.startBar + region.endBar) / 2, price: (region.lowPrice + region.highPrice) / 2 }
    dropLinksOf(model, CLUSTER_HUB)
  }
  if (model.reducedMotion || !model.spider) {
    lasso.closedAt = now
    model.lasso = lasso
    return
  }
  model.wrap = { lasso, phase: 'approach', phaseStartedAt: now, progress: 0, release: 0, approachDirection: null }
}

export function dropLinksOf(model: CrawlerModel, nodeId: string): void {
  for (const [key, link] of model.links) {
    if (link.a === nodeId || link.b === nodeId) model.links.delete(key)
  }
}

export const STRETCH_LIMIT = 1.3

export function pruneStretchedLinks(model: CrawlerModel, threshold: number): void {
  const byId = new Map(model.nodes.map((node) => [node.id, node]))
  for (const [key, link] of model.links) {
    const a = byId.get(link.a)
    const b = byId.get(link.b)
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > threshold * STRETCH_LIMIT) model.links.delete(key)
  }
}

function completeTap(model: CrawlerModel, now: number): void {
  const tap = model.tap
  if (!tap) return
  const node = model.nodes.find((candidate) => candidate.id === tap.nodeId)
  if (node && tap.phase !== 'return') node.pulse = { status: tap.status, startedAt: now }
  const leg = model.spider?.legs[tap.legIndex]
  if (leg) leg.override = null
  model.tap = null
}

export function pulseNode(model: CrawlerModel, nodeId: string, status: CheckStatus, now: number): void {
  const node = model.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  completeTap(model, now)
  const spider = model.spider
  if (model.reducedMotion || !spider || spider.state === 'frozen' || spider.airborne) {
    node.pulse = { status, startedAt: now }
    return
  }
  const left = spider.legs.findIndex((leg) => leg.geometry.id === 'L1')
  const right = spider.legs.findIndex((leg) => leg.geometry.id === 'R1')
  const pick = (index: number) => {
    const foot = spider.legs[index]?.foot
    return foot ? Math.hypot(foot.x - node.x, foot.y - node.y) : Number.POSITIVE_INFINITY
  }
  model.tap = {
    nodeId,
    status,
    legIndex: pick(left) <= pick(right) ? left : right,
    phase: 'approach',
    phaseStartedAt: now,
  }
}

export function moveSpiderTo(model: CrawlerModel, point: Point): void {
  model.goal = { kind: 'stage', point }
  if (model.spider && model.spider.state === 'resting') {
    model.spider.state = 'idle'
    model.spider.foldTarget = 0
  }
}

export function setAggression(model: CrawlerModel, level: number): void {
  model.aggression = Math.min(1, Math.max(0, level))
  if (model.spider) model.spider.aggression = model.aggression
}

export function setTempo(model: CrawlerModel, tempo: number): void {
  model.tempo = Math.min(4, Math.max(0.25, tempo))
  if (model.spider) model.spider.tempo = model.tempo
}

export function finishRun(model: CrawlerModel, now: number): void {
  model.phase = 'done'
  model.beamBar = null
  settleWrap(model, now)
  completeTap(model, now)
  model.goal = { kind: 'hold' }
  rest(model)
}

export function rest(model: CrawlerModel): void {
  const spider = model.spider
  if (!spider) return
  spider.state = 'resting'
  spider.foldTarget = 1
  spider.target = { x: spider.x, y: spider.y }
}

export function failRun(model: CrawlerModel, stage: Stage, now: number): void {
  model.phase = 'failed'
  model.failedStage = stage
  model.failedAt = now
  model.stages[stage].state = 'fail'
  model.beamBar = null
  model.dragStage = stage
  completeTap(model, now)
  if (model.wrap) settleWrap(model, now)
  model.nextRebuildAt = Number.POSITIVE_INFINITY
  freeze(model)
}

export function freeze(model: CrawlerModel): void {
  const spider = model.spider
  if (!spider) return
  spider.state = 'frozen'
  spider.foldTarget = 0.7
  spider.target = null
  spider.vx = 0
  spider.vy = 0
  clearOverrides(model)
}

export function activity(model: CrawlerModel): number {
  switch (model.phase) {
    case 'idle':
      return model.spider ? 0.5 : 0
    case 'running': {
      const total = STAGES.reduce((sum, stage) => sum + model.stages[stage].progress, 0)
      return 0.25 + 0.75 * (total / (STAGES.length * 100))
    }
    case 'done':
      return 0.4
    case 'failed':
      return 0.3
  }
}

export function retractAmount(model: CrawlerModel, now: number): number {
  if (model.phase !== 'failed') return 0
  if (model.reducedMotion) return 1
  return Math.min(1, Math.max(0, (now - model.failedAt) / RETRACT_MS))
}

function nodeVisible(model: CrawlerModel, node: WebNode): number {
  if (!node.onScreen) return 0
  if (model.phase === 'idle' && !model.spider) return 0
  switch (node.kind) {
    case 'ambient':
      return 1
    case 'anchor':
      return model.stages.DATA.progress >= 100 || model.phase === 'idle' ? 1 : 0
    case 'check':
      return model.stages.AUDITOR.state !== 'wait' ? 1 : 0
    case 'cluster':
      return node.data ? 1 : 0
  }
}

export function placeNodes(
  model: CrawlerModel,
  measure: CrawlerMeasure,
  project: (bar: number, price: number) => Point | null,
): void {
  const { plot, ports } = measure
  const auditor = ports[STAGES.indexOf('AUDITOR')]
  for (const node of model.nodes) {
    let point: Point | null = null
    if (node.kind === 'ambient') point = { x: plot.left + node.u * plot.width, y: plot.top + node.v * plot.height }
    else if (node.kind === 'check') {
      const index = CHECK_IDS.findIndex((id) => checkNodeId(id) === node.id)
      point = auditor ? { x: auditor.x + (index - 2.5) * 24, y: auditor.y + 70 + (index % 2) * 16 } : null
    } else if (node.data) point = project(node.data.bar, node.data.price)
    if (point) {
      node.x = point.x
      node.y = point.y
    }
    node.onScreen =
      point !== null &&
      point.x >= plot.left &&
      point.x <= plot.left + plot.width &&
      point.y >= plot.top &&
      point.y <= plot.top + plot.height
  }
}

function resolveGoal(model: CrawlerModel, input: FrameInput): Point | null {
  const goal = model.goal
  const { plot, ports } = input.measure
  if (!goal) return null
  switch (goal.kind) {
    case 'hold':
      return model.spider ? { x: model.spider.x, y: model.spider.y } : null
    case 'stage':
      return goal.point
    case 'checks': {
      const auditor = ports[STAGES.indexOf('AUDITOR')]
      return auditor ? { x: auditor.x, y: auditor.y + 130 } : null
    }
    case 'data': {
      const price = input.priceAt(goal.bar)
      const point = price === null ? null : input.project(goal.bar, price)
      const x = point ? point.x : plot.left + (goal.bar / Math.max(1, model.barCount - 1)) * plot.width
      const y = point ? point.y : plot.top + plot.height * 0.5
      return {
        x: Math.min(plot.left + plot.width - 8, Math.max(plot.left + 8, x)),
        y: Math.min(plot.top + plot.height - 8, Math.max(plot.top + 24, y)),
      }
    }
  }
}

export type WrapGeometry = { centre: Point; rx: number; ry: number }

export function wrapGeometry(
  lasso: Lasso,
  project: (bar: number, price: number) => Point | null,
  padding = 10,
): WrapGeometry | null {
  const topLeft = project(lasso.startBar, lasso.highPrice)
  const bottomRight = project(lasso.endBar, lasso.lowPrice)
  if (!topLeft || !bottomRight) return null
  const left = Math.min(topLeft.x, bottomRight.x) - padding
  const right = Math.max(topLeft.x, bottomRight.x) + padding
  const top = Math.min(topLeft.y, bottomRight.y) - padding
  const bottom = Math.max(topLeft.y, bottomRight.y) + padding
  return { centre: { x: (left + right) / 2, y: (top + bottom) / 2 }, rx: (right - left) / 2, ry: (bottom - top) / 2 }
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

const FRONT_LEGS = ['L1', 'R1', 'L2', 'R2']

function advanceWrap(model: CrawlerModel, input: FrameInput): Point | null {
  const job = model.wrap
  const spider = model.spider
  if (!job || !spider) return null
  const geometry = wrapGeometry(job.lasso, input.project)
  if (!geometry) return null
  const { now } = input
  const length = spider.length
  if (job.phase === 'approach') {
    if (!job.approachDirection) {
      const dx = spider.x - geometry.centre.x
      const dy = spider.y - geometry.centre.y
      const distance = Math.hypot(dx, dy)
      job.approachDirection = distance > 1 ? { x: dx / distance, y: dy / distance } : { x: 0, y: -1 }
    }
    const offset = Math.min(spider.reach * length * 0.75, Math.max(length * 1.2, Math.min(geometry.rx, geometry.ry)))
    const point = {
      x: geometry.centre.x + job.approachDirection.x * offset,
      y: geometry.centre.y + job.approachDirection.y * offset,
    }
    spider.state = 'crawling'
    const waited = now - job.phaseStartedAt > APPROACH_LIMIT_MS / model.tempo
    const near = Math.hypot(point.x - spider.x, point.y - spider.y) < Math.max(4, length * 0.3)
    if (near || waited) {
      job.phase = 'wrapping'
      job.phaseStartedAt = now
      spider.state = 'wrapping'
    }
    return point
  }
  if (job.phase === 'wrapping') {
    spider.state = 'wrapping'
    job.progress = Math.min(1, (now - job.phaseStartedAt) / (WRAP_MS / model.tempo))
    const converge = easeInOut(job.progress)
    spider.legs.forEach((leg, index) => {
      if (!FRONT_LEGS.includes(leg.geometry.id)) return
      const angle = index * 1.7 + converge * Math.PI * 1.5
      const radius = (1 - converge) * Math.min(geometry.rx, geometry.ry) * 0.6 + 2
      leg.override = { x: geometry.centre.x + Math.cos(angle) * radius, y: geometry.centre.y + Math.sin(angle) * radius }
    })
    if (job.progress >= 1) {
      job.phase = 'releasing'
      job.phaseStartedAt = now
      job.lasso.closedAt = now
      model.lasso = job.lasso
      spider.state = 'releasing'
    }
    return { x: spider.x, y: spider.y }
  }
  spider.state = 'releasing'
  job.release = Math.min(1, (now - job.phaseStartedAt) / (RELEASE_MS / model.tempo))
  if (job.release > 0.35) clearOverrides(model)
  if (job.release >= 1) {
    model.wrap = null
    spider.state = 'idle'
  }
  return { x: spider.x, y: spider.y }
}

function advanceTap(model: CrawlerModel, input: FrameInput): Point | null {
  const tap = model.tap
  const spider = model.spider
  if (!tap || !spider) return null
  const node = model.nodes.find((candidate) => candidate.id === tap.nodeId)
  const leg = spider.legs[tap.legIndex]
  if (!node || !leg) {
    completeTap(model, input.now)
    return null
  }
  const { now } = input
  const stand = { x: node.x, y: node.y + spider.length * 1.6 }
  if (tap.phase === 'approach') {
    const near = Math.hypot(stand.x - spider.x, stand.y - spider.y) < spider.length * 0.5
    if (near || now - tap.phaseStartedAt > TAP_APPROACH_LIMIT_MS / model.tempo) {
      tap.phase = 'reach'
      tap.phaseStartedAt = now
    }
    return stand
  }
  if (tap.phase === 'reach') {
    leg.override = { x: node.x, y: node.y }
    if (now - tap.phaseStartedAt >= TAP_REACH_MS / model.tempo) {
      node.pulse = { status: tap.status, startedAt: now }
      tap.phase = 'return'
      tap.phaseStartedAt = now
    }
    return stand
  }
  leg.override = null
  if (now - tap.phaseStartedAt >= TAP_RETURN_MS / model.tempo) model.tap = null
  return stand
}

function rebuild(model: CrawlerModel, input: FrameInput): void {
  const threshold = scaledThreshold(model.params.linkDistance, input.measure.plot)
  const live = model.nodes.filter((node) => node.onScreen && nodeVisible(model, node) > 0)
  const chosen = chooseLinks(live, threshold, {
    targetCount: activeLinkTarget(activity(model)),
    maxDegree: 5,
    attractor: model.spider ? { x: model.spider.x, y: model.spider.y } : null,
    random: model.random,
  })
  applyLinks(model.links, chosen, activity(model), model.dragStage, model.reducedMotion)
}

function spawn(model: CrawlerModel, input: FrameInput): void {
  const { plot, ports } = input.measure
  const port = ports[STAGES.indexOf('DATA')] ?? { x: plot.left + plot.width / 2, y: plot.top }
  const spider = createSpider({ x: port.x, y: port.y + 4 }, spiderTuning(model.params))
  spider.airborne = true
  spider.tempo = model.tempo
  spider.aggression = model.aggression
  spider.state = 'crawling'
  spider.target = { x: port.x, y: plot.top + plot.height * 0.3 }
  model.spider = spider
  model.spawnPending = false
  if (model.reducedMotion) {
    spider.x = spider.target.x
    spider.y = spider.target.y
    spider.airborne = false
  }
}

export function stepModel(model: CrawlerModel, input: FrameInput): void {
  const { measure, now } = input
  const dt = Math.min(0.1, Math.max(0, input.dt))
  placeNodes(model, measure, input.project)
  const reduced = model.reducedMotion
  for (const node of model.nodes) {
    if (!reduced) driftAmbient(node, measure.plot, model.params.driftSpeed, dt)
    const target = nodeVisible(model, node)
    const step = reduced ? 1 : dt / 0.6
    node.visibility = node.visibility < target ? Math.min(target, node.visibility + step) : Math.max(target, node.visibility - step)
  }
  if (!reduced) fadeLinks(model.links, dt)
  pruneStretchedLinks(model, scaledThreshold(model.params.linkDistance, measure.plot))
  if (now >= model.nextRebuildAt && model.phase !== 'failed') {
    rebuild(model, input)
    model.nextRebuildAt = now + nextRebuildDelay(model.params, model.random)
  }
  if (model.lasso?.closedAt && now - model.lasso.closedAt > LASSO_HOLD_MS + LASSO_FADE_MS && !model.wrap) {
    model.lasso = null
  }

  if (model.spawnPending) spawn(model, input)
  const spider = model.spider
  if (!spider) return
  spider.tempo = model.tempo

  if (spider.state !== 'frozen') {
    let target: Point | null = null
    if (spider.airborne) target = spider.target
    else if (model.wrap) target = advanceWrap(model, input)
    else if (model.tap) target = advanceTap(model, input)
    if (!target && !spider.airborne) target = resolveGoal(model, input)
    if (target) spider.target = target
    if (!spider.airborne && !model.wrap && spider.state !== 'resting') {
      spider.state = isArrived(spider) ? 'idle' : 'crawling'
    }
  }

  if (reduced) {
    if (spider.target && spider.state !== 'frozen') {
      spider.x = spider.target.x
      spider.y = spider.target.y
    }
    spider.airborne = false
    spider.vx = 0
    spider.vy = 0
    spider.fold = spider.state === 'frozen' ? 0.7 : 1
    spider.foldTarget = spider.fold
    clearOverrides(model)
    model.wrap = null
    for (const leg of spider.legs) {
      leg.swingStart = null
      leg.lift = 0
    }
    stepLegs(spider, { now, dt: 1, footholds: [], snapRadius: 0 })
    return
  }

  moveBody(spider, dt)
  if (spider.airborne && isArrived(spider)) {
    spider.airborne = false
    spider.foldTarget = 0
    spider.state = 'idle'
  }
  const footholds = model.nodes.filter((node) => node.visibility > 0.5 && node.onScreen)
  stepLegs(spider, { now, dt, footholds, snapRadius: spider.length * 0.9 })
}

export function liftedSet(model: CrawlerModel, now: number): Set<string> {
  const lifted = new Set<string>()
  for (const leg of model.spider?.legs ?? []) {
    if (leg.swingStart !== null && now >= leg.swingStart) lifted.add(legSet(leg.geometry.id))
  }
  return lifted
}
