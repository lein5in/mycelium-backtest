import { describe, expect, it } from 'vitest'
import { STAGES } from '../../api/runEvents'
import {
  checkNodeId,
  createModel,
  failRun,
  finishRun,
  pulseNode,
  retractAmount,
  setAnchors,
  setBeam,
  setStageProgress,
  setTempo,
  startRun,
  stepModel,
  wrapRegion,
  type CrawlerModel,
} from './model'
import { MAX_NODES } from './params'
import { liftedLegs } from './spider'
import type { CrawlerMeasure } from './types'

const measure: CrawlerMeasure = {
  stage: { width: 1200, height: 760 },
  ports: STAGES.map((_, index) => ({ x: 100 + index * 200, y: 60 })),
  plot: { left: 60, top: 60, width: 1100, height: 650 },
}
const project = (bar: number, price: number) => ({ x: 60 + (bar / 399) * 1100, y: 60 + (1 - price) * 650 })
const priceAt = () => 0.5

function run(model: CrawlerModel, from: number, ms: number, step = 16): number {
  let now = from
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    now += step
    stepModel(model, { measure, project, priceAt, now, dt: step / 1000 })
  }
  return now
}

function landed(seed = 1, reduced = false): { model: CrawlerModel; now: number } {
  const model = createModel(seed, reduced)
  startRun(model, 400)
  setStageProgress(model, 'DATA', 0)
  const now = run(model, 0, 2500)
  return { model, now }
}

describe('crawler model: nodes and caps', () => {
  it('never exceeds 90 nodes, even with the largest node count and many anchors', () => {
    const model = createModel(1, false, { nodeCount: 70 })
    setAnchors(model, Array.from({ length: 40 }, (_, bar) => ({ bar: bar * 9, price: 0.5 })))
    expect(model.nodes.length).toBeLessThanOrEqual(MAX_NODES)
    expect(model.nodes.filter((n) => n.kind === 'ambient').length).toBeGreaterThanOrEqual(45)
  })

  it('keeps the web hidden and spiderless before run_started', () => {
    const model = createModel(1, false)
    run(model, 0, 1500)
    expect(model.spider).toBeNull()
    expect(model.links.size).toBe(0)
    expect(model.nodes.every((n) => n.visibility === 0)).toBe(true)
  })

  it('keeps every stored link short and the count capped during a run', () => {
    const { model, now } = landed()
    setStageProgress(model, 'DATA', 100)
    setStageProgress(model, 'SIGNALS', 60)
    run(model, now, 3000)
    expect(model.links.size).toBeLessThanOrEqual(120)
    const byId = new Map(model.nodes.map((n) => [n.id, n]))
    for (const link of model.links.values()) {
      const a = byId.get(link.a)
      const b = byId.get(link.b)
      expect(a && b && Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(140 * 1.4 * 1.3)
    }
  })
})

describe('crawler model: events to behaviour', () => {
  it('run_started: the spider descends from the DATA port and lands', () => {
    const model = createModel(1, false)
    startRun(model, 400)
    run(model, 0, 32)
    const spider = model.spider
    expect(spider?.airborne).toBe(true)
    expect(spider?.x).toBeCloseTo(measure.ports[0]?.x ?? 0, 0)
    expect(spider?.y).toBeLessThan(80)
    run(model, 32, 2500)
    expect(spider?.airborne).toBe(false)
    expect(spider?.state).toBe('idle')
    expect(spider?.y).toBeGreaterThan(200)
    expect(model.dragStage).toBe('DATA')
  })

  it('stage_started: the dragline moves to the new stage port', () => {
    const { model } = landed()
    setStageProgress(model, 'DATA', 100)
    setStageProgress(model, 'SIGNALS', 0)
    expect(model.dragStage).toBe('SIGNALS')
  })

  it('stage_progress: the spider follows the simulated bar, never ahead of it', () => {
    const { model, now } = landed()
    setStageProgress(model, 'DATA', 100)
    setStageProgress(model, 'SIGNALS', 100)
    setStageProgress(model, 'SIMULATOR', 0)
    setBeam(model, 200)
    run(model, now, 4000)
    const target = project(200, 0.5)
    expect(model.spider?.x).toBeCloseTo(target.x, -1)
    setBeam(model, 120)
    expect(model.beamBar).toBe(200)
  })

  it('trade_cluster: approach, wrap with front legs converging, release, lasso stays', () => {
    const { model, now } = landed()
    wrapRegion(model, { startBar: 180, endBar: 220, lowPrice: 0.4, highPrice: 0.6, label: 'L' }, now)
    expect(model.wrap?.phase).toBe('approach')
    let t = now
    let sawWrapping = false
    for (let i = 0; i < 400 && model.wrap; i += 1) {
      t = run(model, t, 16)
      if (model.wrap?.phase === 'wrapping' && model.wrap.progress > 0.2) {
        sawWrapping = true
        const spider = model.spider
        const front = spider?.legs.filter((l) => ['L1', 'R1', 'L2', 'R2'].includes(l.geometry.id)) ?? []
        const rear = spider?.legs.filter((l) => ['L3', 'R3', 'L4', 'R4'].includes(l.geometry.id)) ?? []
        expect(front.every((l) => l.override !== null)).toBe(true)
        expect(rear.every((l) => l.override === null)).toBe(true)
        expect(spider?.state).toBe('wrapping')
      }
    }
    expect(sawWrapping).toBe(true)
    expect(model.wrap).toBeNull()
    expect(model.lasso?.closedAt).not.toBeNull()
    expect(model.spider?.legs.every((l) => l.override === null)).toBe(true)
  })

  it('check_done: the node pulses only when the front leg taps it', () => {
    const { model, now } = landed()
    setStageProgress(model, 'AUDITOR', 0)
    let t = run(model, now, 1500)
    pulseNode(model, checkNodeId('costs'), 'WARN', t)
    const node = model.nodes.find((n) => n.id === checkNodeId('costs'))
    expect(node?.pulse).toBeNull()
    expect(model.tap?.phase).toBe('approach')
    for (let i = 0; i < 200 && !node?.pulse; i += 1) t = run(model, t, 16)
    expect(node?.pulse?.status).toBe('WARN')
    const leg = model.spider?.legs.find((l) => l.override)
    expect(leg && ['L1', 'R1'].includes(leg.geometry.id)).toBe(true)
  })

  it('run_done: the spider rests with legs folded', () => {
    const { model, now } = landed()
    finishRun(model, now)
    run(model, now, 2000)
    expect(model.spider?.state).toBe('resting')
    expect(model.spider?.fold).toBeGreaterThan(0.95)
    expect(model.phase).toBe('done')
  })

  it('run_failed: the spider freezes, legs draw in, failing threads retract, rebuilds stop', () => {
    const { model, now } = landed()
    setStageProgress(model, 'DATA', 100)
    setStageProgress(model, 'SIGNALS', 100)
    setStageProgress(model, 'SIMULATOR', 0)
    setBeam(model, 300)
    let t = run(model, now, 600)
    const before = { x: model.spider?.x, y: model.spider?.y }
    failRun(model, 'SIMULATOR', t)
    t = run(model, t, 2000)
    expect(model.spider?.state).toBe('frozen')
    expect(model.spider?.x).toBe(before.x)
    expect(model.spider?.y).toBe(before.y)
    expect(model.spider?.fold).toBeGreaterThan(0.5)
    const spider = model.spider
    expect(spider && liftedLegs(spider, t).size).toBe(0)
    expect(model.stages.SIMULATOR.state).toBe('fail')
    expect(retractAmount(model, t)).toBe(1)
    expect(model.nextRebuildAt).toBe(Number.POSITIVE_INFINITY)
  })

  it('does not move the spider without an event', () => {
    const { model, now } = landed()
    const settled = run(model, now, 3000)
    const x = model.spider?.x
    const y = model.spider?.y
    run(model, settled, 5000)
    expect(model.spider?.x).toBeCloseTo(x ?? 0, 0)
    expect(model.spider?.y).toBeCloseTo(y ?? 0, 0)
  })

  it('compresses wraps when the tempo rises', () => {
    const slow = landed().model
    const fast = landed().model
    setTempo(fast, 4)
    const duration = (model: CrawlerModel) => {
      wrapRegion(model, { startBar: 180, endBar: 220, lowPrice: 0.4, highPrice: 0.6, label: 'L' }, 2500)
      let t = 2500
      let frames = 0
      while (model.wrap && frames < 1000) {
        t = run(model, t, 16)
        frames += 1
      }
      return frames
    }
    expect(duration(fast)).toBeLessThan(duration(slow))
  })
})

describe('crawler model: reduced motion', () => {
  it('shows a static web, no drift, the spider resting with legs folded', () => {
    const { model, now } = landed(1, true)
    const ambient = model.nodes.filter((n) => n.kind === 'ambient').map((n) => [n.u, n.v])
    run(model, now, 1000)
    expect(model.nodes.filter((n) => n.kind === 'ambient').map((n) => [n.u, n.v])).toEqual(ambient)
    expect(model.spider?.fold).toBe(1)
    expect(model.spider?.airborne).toBe(false)
    expect([...model.links.values()].every((l) => l.alpha === l.target)).toBe(true)
  })

  it('closes wraps and pulses at once', () => {
    const { model, now } = landed(1, true)
    wrapRegion(model, { startBar: 10, endBar: 30, lowPrice: 0.2, highPrice: 0.4, label: 'L' }, now)
    expect(model.wrap).toBeNull()
    expect(model.lasso?.closedAt).toBe(now)
    setStageProgress(model, 'AUDITOR', 0)
    pulseNode(model, checkNodeId('robustness'), 'FAIL', now)
    expect(model.nodes.find((n) => n.id === checkNodeId('robustness'))?.pulse?.status).toBe('FAIL')
  })

  it('moves the spider straight to its goal without walking', () => {
    const { model, now } = landed(1, true)
    setStageProgress(model, 'DATA', 50)
    run(model, now, 16)
    const target = project(0.5 * 399, 0.5)
    expect(model.spider?.x).toBeCloseTo(target.x, 0)
  })
})
