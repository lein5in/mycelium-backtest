import { STAGES, type CheckStatus } from '../../api/runEvents'
import { withAlpha, type Theme } from '../../theme/tokens'
import {
  LASSO_FADE_MS,
  LASSO_HOLD_MS,
  retractAmount,
  wrapGeometry,
  type CrawlerModel,
  type Lasso,
} from './model'
import { axes, legJoints, sway, type Spider } from './spider'
import type { CrawlerMeasure, Point } from './types'
import type { WebNode } from './web'

const BUCKETS = 4
export const GLOW_SCALE = 0.5
const PULSE_MS = 1100
const MAGENTA_FLASH_MS = 600

type Project = (bar: number, price: number) => Point | null

export type FrameStats = { strokeCalls: number; fillCalls: number; links: number }

const statusColour = (theme: Theme, status: CheckStatus) =>
  status === 'PASS' ? theme.profit : status === 'WARN' ? theme.warn : theme.loss

function makeSprite(colour: string, coreColour: string, radius: number, scale: number): HTMLCanvasElement {
  const size = Math.ceil(radius * 8 * scale)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const centre = size / 2
  const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre)
  gradient.addColorStop(0, withAlpha(coreColour, 1))
  gradient.addColorStop(0.12, withAlpha(coreColour, 0.95))
  gradient.addColorStop(0.2, withAlpha(colour, 0.85))
  gradient.addColorStop(0.42, withAlpha(colour, 0.18))
  gradient.addColorStop(1, withAlpha(colour, 0))
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return canvas
}

export class CrawlerRenderer {
  private sprites = new Map<string, HTMLCanvasElement>()
  private scale = 1
  private glowCanvas: HTMLCanvasElement | null = null
  private glow: CanvasRenderingContext2D | null = null
  stats: FrameStats = { strokeCalls: 0, fillCalls: 0, links: 0 }

  constructor(private readonly theme: Theme) {}

  setScale(scale: number): void {
    if (scale !== this.scale) {
      this.scale = scale
      this.sprites.clear()
    }
  }

  private sprite(colour: string, radius: number): HTMLCanvasElement {
    const key = `${colour}:${radius.toFixed(1)}`
    let sprite = this.sprites.get(key)
    if (!sprite) {
      sprite = makeSprite(colour, this.theme['node-core'], radius, this.scale)
      this.sprites.set(key, sprite)
    }
    return sprite
  }

  private drawSprite(context: CanvasRenderingContext2D, colour: string, x: number, y: number, radius: number, alpha: number) {
    if (alpha <= 0.01) return
    const sprite = this.sprite(colour, radius)
    const size = sprite.width / this.scale
    context.globalAlpha = Math.min(1, alpha)
    context.drawImage(sprite, x - size / 2, y - size / 2, size, size)
    context.globalAlpha = 1
  }

  draw(context: CanvasRenderingContext2D, model: CrawlerModel, measure: CrawlerMeasure, now: number, project: Project) {
    this.stats = { strokeCalls: 0, fillCalls: 0, links: 0 }
    context.clearRect(0, 0, measure.stage.width, measure.stage.height)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    this.prepareGlow(measure, model.params.glowBlur)
    this.drawBeam(context, model, measure, project)
    this.drawWeb(context, model, now)
    this.drawDraglines(context, model, measure, now)
    this.drawSpiral(context, model, project)
    this.drawLasso(context, model, now, project)
    this.drawNodes(context, model, now)
    this.drawPorts(context, model, measure)
    if (model.spider) this.drawSpider(context, model, model.spider)
    this.compositeGlow(context, measure)
    this.fadeAxes(context, measure)
  }

  private prepareGlow(measure: CrawlerMeasure, blur: number) {
    if (!this.glowCanvas) {
      this.glowCanvas = document.createElement('canvas')
      this.glow = this.glowCanvas.getContext('2d')
    }
    const glow = this.glow
    const canvas = this.glowCanvas
    if (!glow) return
    const width = Math.max(1, Math.ceil(measure.stage.width * GLOW_SCALE))
    const height = Math.max(1, Math.ceil(measure.stage.height * GLOW_SCALE))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    glow.setTransform(1, 0, 0, 1, 0, 0)
    glow.clearRect(0, 0, width, height)
    glow.setTransform(GLOW_SCALE, 0, 0, GLOW_SCALE, 0, 0)
    glow.lineCap = 'round'
    glow.lineJoin = 'round'
    glow.shadowBlur = blur * GLOW_SCALE
  }

  private glowStroke(path: Path2D, colour: string, alpha: number, width: number, shadow: string) {
    const glow = this.glow
    if (!glow) return
    glow.shadowColor = withAlpha(shadow, 0.8)
    glow.strokeStyle = withAlpha(colour, alpha)
    glow.lineWidth = width
    glow.stroke(path)
    this.stats.strokeCalls += 1
  }

  private compositeGlow(context: CanvasRenderingContext2D, measure: CrawlerMeasure) {
    if (!this.glowCanvas) return
    context.save()
    context.globalCompositeOperation = 'destination-over'
    context.imageSmoothingEnabled = true
    context.drawImage(this.glowCanvas, 0, 0, measure.stage.width, measure.stage.height)
    context.restore()
  }

  private stroke(context: CanvasRenderingContext2D, path: Path2D) {
    context.stroke(path)
    this.stats.strokeCalls += 1
  }

  private fill(context: CanvasRenderingContext2D, path: Path2D | null) {
    if (path) context.fill(path)
    else context.fill()
    this.stats.fillCalls += 1
  }

  private drawWeb(context: CanvasRenderingContext2D, model: CrawlerModel, now: number) {
    const theme = this.theme
    const byId = new Map(model.nodes.map((node) => [node.id, node]))
    const retract = retractAmount(model, now)
    const normal: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D())
    const used = new Array<boolean>(BUCKETS).fill(false)
    const failed = new Path2D()
    let anyFailed = false
    for (const link of model.links.values()) {
      const a = byId.get(link.a)
      const b = byId.get(link.b)
      if (!a || !b || !a.onScreen || !b.onScreen) continue
      const alpha = link.alpha * Math.min(a.visibility, b.visibility)
      if (alpha < 0.03) continue
      this.stats.links += 1
      const isFailed = model.failedStage !== null && link.stage === model.failedStage
      if (isFailed) {
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        const keep = 1 - retract
        if (keep <= 0.02) continue
        failed.moveTo(midX + (a.x - midX) * keep, midY + (a.y - midY) * keep)
        failed.lineTo(midX + (b.x - midX) * keep, midY + (b.y - midY) * keep)
        anyFailed = true
        continue
      }
      const bucket = Math.min(BUCKETS - 1, Math.floor(((alpha - 0.03) / 0.68) * BUCKETS))
      const path = normal[bucket]
      if (!path) continue
      used[bucket] = true
      const bend = ((a.x * 13 + b.y * 7) % 9) / 9 - 0.5
      const midX = (a.x + b.x) / 2 - (b.y - a.y) * 0.06 * bend
      const midY = (a.y + b.y) / 2 + (b.x - a.x) * 0.06 * bend
      path.moveTo(a.x, a.y)
      path.quadraticCurveTo(midX, midY, b.x, b.y)
    }
    const bucketAlpha = (index: number) => 0.03 + ((index + 0.5) / BUCKETS) * 0.68
    normal.forEach((path, index) => {
      if (used[index]) this.glowStroke(path, theme.violet, bucketAlpha(index) * 0.4, 2.2 + index * 0.5, theme.violet)
    })
    if (anyFailed) this.glowStroke(failed, theme.loss, 0.32 * (1 - retract * 0.5), 2.6, theme.loss)
    normal.forEach((path, index) => {
      if (!used[index]) return
      const core = index >= BUCKETS - 1 ? theme['node-core'] : theme['violet-text']
      context.strokeStyle = withAlpha(core, bucketAlpha(index))
      context.lineWidth = 0.55 + index * 0.22
      this.stroke(context, path)
    })
    if (anyFailed) {
      context.strokeStyle = withAlpha(theme['loss-text'], 0.75 * (1 - retract * 0.6))
      context.lineWidth = 0.9
      this.stroke(context, failed)
    }
  }

  private drawDraglines(context: CanvasRenderingContext2D, model: CrawlerModel, measure: CrawlerMeasure, now: number) {
    const theme = this.theme
    const stubs = new Path2D()
    let anyStub = false
    STAGES.forEach((stage, index) => {
      const port = measure.ports[index]
      if (!port || model.stages[stage].state === 'wait' || stage === model.dragStage) return
      stubs.moveTo(port.x, port.y)
      stubs.lineTo(port.x, port.y + 14)
      anyStub = true
    })
    if (anyStub) {
      context.strokeStyle = withAlpha(theme.violet, 0.4)
      context.lineWidth = 0.8
      this.stroke(context, stubs)
    }
    const spider = model.spider
    const stageIndex = model.dragStage ? STAGES.indexOf(model.dragStage) : -1
    const port = measure.ports[stageIndex]
    if (!spider || !port) return
    const failed = model.phase === 'failed' && model.failedStage === model.dragStage
    const keep = failed ? 1 - retractAmount(model, now) : 1
    if (keep <= 0.02) return
    const { forward } = axes(spider)
    const anchor = { x: spider.x - forward.x * spider.length * 0.55, y: spider.y - forward.y * spider.length * 0.55 }
    const end = { x: port.x + (anchor.x - port.x) * keep, y: port.y + (anchor.y - port.y) * keep }
    const line = new Path2D()
    line.moveTo(port.x, port.y)
    line.lineTo(end.x, end.y)
    const colour = failed ? theme.loss : theme.violet
    this.glowStroke(line, colour, 0.3, 2, colour)
    context.strokeStyle = withAlpha(failed ? theme['loss-text'] : theme['violet-text'], 0.6)
    context.lineWidth = 0.7
    this.stroke(context, line)
  }

  private drawSpiral(context: CanvasRenderingContext2D, model: CrawlerModel, project: Project) {
    const job = model.wrap
    if (!job || job.phase === 'approach') return
    const geometry = wrapGeometry(job.lasso, project, 14)
    if (!geometry) return
    const theme = this.theme
    const eased = job.phase === 'wrapping' ? easeInOut(job.progress) : 1
    const alpha = job.phase === 'wrapping' ? 0.45 + 0.4 * eased : 0.85 * (1 - job.release)
    const drop = job.phase === 'releasing' ? job.release * 14 : 0
    if (alpha <= 0.02) return
    const turns = model.params.spiralTurns
    const total = turns * Math.PI * 2
    const steps = Math.ceil(turns * 48)
    const path = new Path2D()
    const drawn = Math.max(1, Math.floor(steps * eased))
    for (let index = 0; index <= drawn; index += 1) {
      const theta = (index / steps) * total
      const shrink = 1 - 0.55 * (theta / total)
      const x = geometry.centre.x + Math.cos(theta - Math.PI / 2) * geometry.rx * shrink
      const y = geometry.centre.y + Math.sin(theta - Math.PI / 2) * geometry.ry * shrink + drop
      if (index === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    }
    this.glowStroke(path, theme.cyan, alpha * 0.45, 2.4, theme.cyan)
    context.strokeStyle = withAlpha(theme['node-core'], alpha * 0.85)
    context.lineWidth = 0.9
    this.stroke(context, path)
  }

  private drawLasso(context: CanvasRenderingContext2D, model: CrawlerModel, now: number, project: Project) {
    const lasso: Lasso | null = model.lasso
    if (!lasso || lasso.closedAt === null) return
    const geometry = wrapGeometry(lasso, project, 10)
    if (!geometry) return
    const age = now - lasso.closedAt
    const fade = age <= LASSO_HOLD_MS ? 1 : Math.max(0, 1 - (age - LASSO_HOLD_MS) / LASSO_FADE_MS)
    if (fade <= 0) return
    const theme = this.theme
    const left = geometry.centre.x - geometry.rx
    const right = geometry.centre.x + geometry.rx
    const top = geometry.centre.y - geometry.ry
    const bottom = geometry.centre.y + geometry.ry
    const shape = octagon(left, top, right, bottom)
    const path = new Path2D()
    shape.forEach((point, index) => (index === 0 ? path.moveTo(point.x, point.y) : path.lineTo(point.x, point.y)))
    path.closePath()
    const flash = !model.reducedMotion && age < MAGENTA_FLASH_MS ? 1 - age / MAGENTA_FLASH_MS : 0
    context.save()
    context.fillStyle = withAlpha(theme.magenta, (0.04 + 0.06 * flash) * fade)
    this.fill(context, path)
    context.strokeStyle = withAlpha(flash > 0 ? theme.magenta : theme['violet-text'], (0.55 + 0.3 * flash) * fade)
    context.lineWidth = 1
    context.setLineDash([5, 4])
    context.lineDashOffset = model.reducedMotion ? 0 : -((now / 80) % 9)
    this.stroke(context, path)
    context.restore()
    context.font = '500 10px "IBM Plex Mono", monospace'
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    const width = context.measureText(lasso.label).width
    const labelY = top - 11
    context.globalAlpha = fade
    context.fillStyle = withAlpha(theme['bg-app'], 0.85)
    context.fillRect(left, labelY - 7, width + 10, 14)
    context.fillStyle = theme['violet-text']
    context.fillText(lasso.label, left + 5, labelY + 0.5)
    context.globalAlpha = 1
  }

  private nodeColour(node: WebNode): string {
    if (node.pulse) return statusColour(this.theme, node.pulse.status)
    if (node.kind === 'anchor') return this.theme.cyan
    if (node.kind === 'cluster') return this.theme.cyan
    if (node.kind === 'check') return this.theme['violet-text']
    return this.theme.violet
  }

  private drawNodes(context: CanvasRenderingContext2D, model: CrawlerModel, now: number) {
    const theme = this.theme
    const rings = new Map<string, Path2D>()
    for (const node of model.nodes) {
      if (!node.onScreen || node.visibility < 0.01) continue
      const base = node.kind === 'ambient' ? 0.75 : 1
      this.drawSprite(context, this.nodeColour(node), node.x, node.y, node.radius, node.visibility * base)
      if (node.pulse && !model.reducedMotion) {
        const age = (now - node.pulse.startedAt) / PULSE_MS
        if (age >= 0 && age < 1) {
          const colour = statusColour(theme, node.pulse.status)
          const path = rings.get(colour) ?? new Path2D()
          const radius = node.radius + 3 + 16 * age
          path.moveTo(node.x + radius, node.y)
          path.arc(node.x, node.y, radius, 0, Math.PI * 2)
          rings.set(colour, path)
        }
      }
    }
    context.lineWidth = 1.4
    for (const [colour, path] of rings) {
      context.strokeStyle = withAlpha(colour, 0.8)
      this.stroke(context, path)
    }
  }

  private drawPorts(context: CanvasRenderingContext2D, model: CrawlerModel, measure: CrawlerMeasure) {
    const theme = this.theme
    STAGES.forEach((stage, index) => {
      const port = measure.ports[index]
      if (!port) return
      const state = model.stages[stage].state
      const colour =
        state === 'fail' ? theme.loss : state === 'wait' ? theme['text-3'] : state === 'run' ? theme['violet-text'] : theme.violet
      this.drawSprite(context, colour, port.x, port.y, state === 'run' ? 3.4 : 2.8, state === 'wait' ? 0.6 : 1)
    })
  }

  private drawSpider(context: CanvasRenderingContext2D, model: CrawlerModel, spider: Spider) {
    const theme = this.theme
    const length = spider.length
    const offset = sway(spider)
    const frozen = spider.state === 'frozen'
    const failedColour = frozen && model.phase === 'failed'
    const bodyColour = failedColour ? theme.loss : theme.violet
    const glow = new Path2D()
    const planted = new Path2D()
    const lifted = new Path2D()
    let anyLifted = false
    const scale = length / 23
    for (const leg of spider.legs) {
      const { hip, knee, foot } = legJoints(spider, leg)
      const h = { x: hip.x + offset.x, y: hip.y + offset.y }
      const k = { x: knee.x + offset.x * 0.5, y: knee.y + offset.y * 0.5 }
      glow.moveTo(h.x, h.y)
      glow.lineTo(k.x, k.y)
      glow.lineTo(foot.x, foot.y)
      const raised = leg.lift > 0.15
      const thin = raised ? 0.78 : 1
      const target = raised ? lifted : planted
      if (raised) anyLifted = true
      taperedSegment(target, h, k, 2.2 * scale * thin, 1.5 * scale * thin)
      taperedSegment(target, k, foot, 1.5 * scale * thin, 0.8 * scale * thin)
    }
    const { forward, right } = axes(spider)
    const head = { x: spider.x + offset.x + forward.x * length * 0.4, y: spider.y + offset.y + forward.y * length * 0.4 }
    for (const side of [-1, 1]) {
      const tip = {
        x: head.x + forward.x * length * 0.16 + right.x * side * length * 0.12,
        y: head.y + forward.y * length * 0.16 + right.y * side * length * 0.12,
      }
      taperedSegment(planted, head, tip, 1.2 * scale, 0.6 * scale)
      glow.moveTo(head.x, head.y)
      glow.lineTo(tip.x, tip.y)
    }
    this.glowStroke(glow, bodyColour, 0.45, 3.4 * scale, bodyColour)
    context.fillStyle = withAlpha(failedColour ? theme['loss-text'] : theme['violet-text'], 0.92)
    this.fill(context, planted)
    if (anyLifted) {
      context.fillStyle = withAlpha(theme['node-core'], 0.8)
      this.fill(context, lifted)
    }
    const breathe = 1 + Math.sin(spider.breath * 2.1) * 0.03
    const centre = { x: spider.x + offset.x, y: spider.y + offset.y }
    const abdomen = { x: centre.x - forward.x * length * 0.24, y: centre.y - forward.y * length * 0.24 }
    const thorax = { x: centre.x + forward.x * length * 0.22, y: centre.y + forward.y * length * 0.22 }
    this.drawSprite(context, bodyColour, centre.x, centre.y, length * 0.42, 0.7)
    this.bodyPart(context, abdomen, length * 0.31 * breathe, length * 0.25 * breathe, spider.heading, bodyColour, 1)
    this.bodyPart(context, thorax, length * 0.21, length * 0.18, spider.heading, bodyColour, 1)
  }

  private bodyPart(
    context: CanvasRenderingContext2D,
    centre: Point,
    rx: number,
    ry: number,
    heading: number,
    colour: string,
    alpha: number,
  ) {
    const theme = this.theme
    const gradient = context.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, Math.max(rx, ry))
    gradient.addColorStop(0, withAlpha(theme['node-core'], alpha))
    gradient.addColorStop(0.3, withAlpha(theme['violet-text'], 0.95 * alpha))
    gradient.addColorStop(0.75, withAlpha(colour, 0.9 * alpha))
    gradient.addColorStop(1, withAlpha(colour, 0.35 * alpha))
    context.fillStyle = gradient
    context.beginPath()
    context.ellipse(centre.x, centre.y, rx, ry, heading, 0, Math.PI * 2)
    this.fill(context, null)
  }

  private drawBeam(context: CanvasRenderingContext2D, model: CrawlerModel, measure: CrawlerMeasure, project: Project) {
    if (model.reducedMotion || model.phase !== 'running' || model.beamBar === null) return
    const point = project(model.beamBar, 0)
    if (!point) return
    const { plot } = measure
    if (point.x < plot.left || point.x > plot.left + plot.width) return
    const theme = this.theme
    const gradient = context.createLinearGradient(0, plot.top, 0, plot.top + plot.height)
    gradient.addColorStop(0, withAlpha(theme.cyan, 0))
    gradient.addColorStop(0.35, withAlpha(theme.cyan, 0.3))
    gradient.addColorStop(1, withAlpha(theme.cyan, 0))
    context.fillStyle = withAlpha(theme.cyan, 0.03)
    context.fillRect(point.x - 10, plot.top, 10, plot.height)
    context.strokeStyle = gradient
    context.lineWidth = 1
    const path = new Path2D()
    path.moveTo(Math.round(point.x) + 0.5, plot.top)
    path.lineTo(Math.round(point.x) + 0.5, plot.top + plot.height)
    this.stroke(context, path)
  }

  private fadeAxes(context: CanvasRenderingContext2D, measure: CrawlerMeasure) {
    const { plot, stage } = measure
    context.save()
    context.globalCompositeOperation = 'destination-out'
    context.fillStyle = 'rgba(0, 0, 0, 0.85)'
    context.fillRect(0, plot.top, plot.left, stage.height - plot.top)
    context.fillRect(plot.left, plot.top + plot.height, stage.width - plot.left, stage.height - plot.top - plot.height)
    context.restore()
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

export function taperedSegment(path: Path2D, from: Point, to: Point, startWidth: number, endWidth: number): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 0.01) return
  const nx = -dy / length
  const ny = dx / length
  const a = startWidth / 2
  const b = endWidth / 2
  path.moveTo(from.x + nx * a, from.y + ny * a)
  path.lineTo(to.x + nx * b, to.y + ny * b)
  path.arc(to.x, to.y, b, Math.atan2(ny, nx), Math.atan2(-ny, -nx))
  path.lineTo(from.x - nx * a, from.y - ny * a)
  path.arc(from.x, from.y, a, Math.atan2(-ny, -nx), Math.atan2(ny, nx))
  path.closePath()
}

export function octagon(left: number, top: number, right: number, bottom: number): Point[] {
  const width = right - left
  const height = bottom - top
  const cut = Math.min(width, height) * 0.29
  return [
    { x: left + cut, y: top },
    { x: right - cut, y: top },
    { x: right, y: top + cut },
    { x: right, y: bottom - cut },
    { x: right - cut, y: bottom },
    { x: left + cut, y: bottom },
    { x: left, y: bottom - cut },
    { x: left, y: top + cut },
  ]
}
