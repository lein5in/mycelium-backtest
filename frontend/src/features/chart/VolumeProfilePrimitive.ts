import type { IPrimitivePaneRenderer, IPrimitivePaneView, PrimitivePaneViewZOrder } from 'lightweight-charts'
import { withAlpha, type Theme } from '../../theme/tokens'
import { SeriesPrimitiveBase, type RenderTarget } from './primitiveBase'
import type { HeatmapGrid } from './types'
import { buildVolumeProfile, type VolumeProfile } from './volumeProfile'

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
  private firstLogical = 0
  private cacheKey = ''
  private profile: VolumeProfile | null = null
  private readonly view = new VolumeProfilePaneView(this)

  constructor(readonly theme: Theme) {
    super()
  }

  setGrid(grid: HeatmapGrid, firstLogical: number): void {
    this.grid = grid
    this.firstLogical = firstLogical
    this.cacheKey = ''
    this.requestUpdate()
  }

  private visibleProfile(): VolumeProfile | null {
    const grid = this.grid
    const range = this.chart?.timeScale().getVisibleLogicalRange()
    if (!grid || !range) return null
    const from = Math.floor(range.from - this.firstLogical)
    const to = Math.ceil(range.to - this.firstLogical)
    const key = `${from}:${to}`
    if (key !== this.cacheKey || !this.profile) {
      this.profile = buildVolumeProfile(grid, from, to)
      this.cacheKey = key
    }
    return this.profile
  }

  updateAllViews(): void {
    const grid = this.grid
    const profile = this.visibleProfile()
    if (!grid || !profile) {
      this.view.frame = null
      return
    }
    const rows: RowGeometry[] = []
    profile.rows.forEach((row, index) => {
      const lowY = this.priceToY(grid.lowest_price + index * grid.price_bucket)
      const highY = this.priceToY(grid.lowest_price + (index + 1) * grid.price_bucket)
      if (lowY === null || highY === null) return
      rows.push({ top: highY, height: lowY - highY, buy: row.buy, sell: row.sell })
    })
    const pocY =
      profile.pocRow >= 0
        ? this.priceToY(grid.lowest_price + (profile.pocRow + 0.5) * grid.price_bucket)
        : null
    this.view.frame = { rows, peak: profile.peak, pocY }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
}
