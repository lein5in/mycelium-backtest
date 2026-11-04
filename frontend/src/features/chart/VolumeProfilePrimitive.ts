import type { IPrimitivePaneRenderer, IPrimitivePaneView, PrimitivePaneViewZOrder } from 'lightweight-charts'
import { withAlpha, type Theme } from '../../theme/tokens'
import { SeriesPrimitiveBase, type RenderTarget } from './primitiveBase'
import type { ChartProfile, HeatmapGrid } from './types'

const MAX_WIDTH = 150
const WIDTH_SHARE = 0.16

type RowGeometry = { top: number; height: number; buy: number; sell: number }

type ProfileFrame = {
  rows: RowGeometry[]
  peak: number
  pocY: number | null
}

class VolumeProfileRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly frame: ProfileFrame | null,
    private readonly theme: Theme,
  ) {}

  draw(target: RenderTarget): void {
    const frame = this.frame
    if (!frame || frame.peak <= 0) return
    const theme = this.theme
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const maxWidth = Math.min(MAX_WIDTH, mediaSize.width * WIDTH_SHARE)
      const right = mediaSize.width
      for (const row of frame.rows) {
        const buyWidth = (row.buy / frame.peak) * maxWidth
        const sellWidth = (row.sell / frame.peak) * maxWidth
        const height = Math.max(1, row.height - 1)
        context.fillStyle = withAlpha(theme.profit, 0.32)
        context.fillRect(right - buyWidth, row.top, buyWidth, height)
        context.fillStyle = withAlpha(theme.loss, 0.32)
        context.fillRect(right - buyWidth - sellWidth, row.top, sellWidth, height)
      }
      if (frame.pocY === null) return
      const y = Math.round(frame.pocY) + 0.5
      context.save()
      context.strokeStyle = withAlpha(theme['warn'], 0.7)
      context.lineWidth = 1
      context.setLineDash([4, 4])
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(right, y)
      context.stroke()
      context.restore()
      context.font = '500 10px "IBM Plex Mono", monospace'
      context.textAlign = 'right'
      context.textBaseline = 'bottom'
      context.fillStyle = theme['warn-text']
      context.fillText('POC', right - maxWidth - 6, y - 2)
    })
  }
}

class VolumeProfilePaneView implements IPrimitivePaneView {
  frame: ProfileFrame | null = null

  constructor(private readonly owner: VolumeProfilePrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'normal'
  }

  renderer(): IPrimitivePaneRenderer {
    return new VolumeProfileRenderer(this.frame, this.owner.theme)
  }
}

export class VolumeProfilePrimitive extends SeriesPrimitiveBase {
  private grid: HeatmapGrid | null = null
  private profile: ChartProfile | null = null
  private hidden = false
  private readonly view = new VolumeProfilePaneView(this)

  constructor(readonly theme: Theme) {
    super()
  }

  setProfile(grid: HeatmapGrid, profile: ChartProfile): void {
    this.grid = grid
    this.profile = profile
    this.requestUpdate()
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden
    this.requestUpdate()
  }

  updateAllViews(): void {
    const { grid, profile } = this
    if (!grid || !profile || this.hidden) {
      this.view.frame = null
      return
    }
    const rows: RowGeometry[] = []
    let peak = 0
    for (let index = 0; index < grid.rows; index += 1) {
      const buy = profile.buy[index] ?? 0
      const sell = profile.sell[index] ?? 0
      peak = Math.max(peak, buy + sell)
      const lowY = this.priceToY(grid.lowest_price + index * grid.price_bucket)
      const highY = this.priceToY(grid.lowest_price + (index + 1) * grid.price_bucket)
      if (lowY === null || highY === null) continue
      rows.push({ top: highY, height: lowY - highY, buy, sell })
    }
    const pocY =
      profile.pocRow !== null && profile.pocRow >= 0
        ? this.priceToY(grid.lowest_price + (profile.pocRow + 0.5) * grid.price_bucket)
        : null
    this.view.frame = { rows, peak, pocY }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
}
