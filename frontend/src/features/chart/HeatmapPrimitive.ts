import type { IPrimitivePaneRenderer, IPrimitivePaneView, PrimitivePaneViewZOrder } from 'lightweight-charts'
import { columnSpans, completedColumns, type ColumnSpans } from './columns'
import { heatmapPixels, type Rgb } from './heatmapColor'
import { SeriesPrimitiveBase, type RenderTarget } from './primitiveBase'
import type { HeatmapGrid } from './types'

export type HeatmapSlice = { column: number; count: number; left: number; right: number }

export type HeatmapFrame = { top: number; bottom: number; slices: HeatmapSlice[] }

class HeatmapRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly image: HTMLCanvasElement | null,
    private readonly frame: HeatmapFrame | null,
  ) {}

  draw(target: RenderTarget): void {
    const { image, frame } = this
    if (!image || !frame || frame.bottom <= frame.top) return
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const top = Math.round(frame.top * verticalPixelRatio)
      const bottom = Math.round(frame.bottom * verticalPixelRatio)
      context.imageSmoothingEnabled = false
      for (const slice of frame.slices) {
        const left = Math.round(slice.left * horizontalPixelRatio)
        const right = Math.round(slice.right * horizontalPixelRatio)
        if (right <= left) continue
        context.drawImage(image, slice.column, 0, slice.count, image.height, left, top, right - left, bottom - top)
      }
    })
  }
}

class HeatmapPaneView implements IPrimitivePaneView {
  frame: HeatmapFrame | null = null

  constructor(private readonly owner: HeatmapPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom'
  }

  renderer(): IPrimitivePaneRenderer {
    return new HeatmapRenderer(this.owner.image, this.frame)
  }
}

export class HeatmapPrimitive extends SeriesPrimitiveBase {
  image: HTMLCanvasElement | null = null
  private grid: HeatmapGrid | null = null
  private spans: ColumnSpans | null = null
  private cursor: number | null = null
  private readonly view = new HeatmapPaneView(this)

  setGrid(grid: HeatmapGrid, barTimes: ArrayLike<number>, ramp: readonly Rgb[]): void {
    this.grid = grid
    this.spans = columnSpans(grid, barTimes)
    const canvas = document.createElement('canvas')
    canvas.width = grid.columns
    canvas.height = grid.rows
    const context = canvas.getContext('2d')
    if (context) {
      const image = context.createImageData(grid.columns, grid.rows)
      image.data.set(heatmapPixels(grid, ramp))
      context.putImageData(image, 0, 0)
    }
    this.image = canvas
    this.requestUpdate()
  }

  setCursor(cursor: number | null): void {
    this.cursor = cursor
    this.requestUpdate()
  }

  columnSpans(): ColumnSpans | null {
    return this.spans
  }

  updateAllViews(): void {
    const { grid, spans } = this
    const spacing = this.barSpacing()
    const top = grid ? this.priceToY(grid.lowest_price + grid.rows * grid.price_bucket) : null
    const bottom = grid ? this.priceToY(grid.lowest_price) : null
    const width = this.chart?.timeScale().width() ?? 0
    if (!grid || !spans || top === null || bottom === null || spacing <= 0) {
      this.view.frame = null
      return
    }
    const allowed = completedColumns(spans, this.cursor)
    const slices: HeatmapSlice[] = []
    if (spans.uniform) {
      const start = this.barToX(spans.first[0] ?? 0)
      if (start !== null && allowed > 0) {
        slices.push({ column: 0, count: allowed, left: start - spacing / 2, right: start - spacing / 2 + allowed * spacing })
      }
    } else {
      for (let column = 0; column < allowed; column += 1) {
        const first = spans.first[column] ?? -1
        const last = spans.last[column] ?? -1
        if (first < 0) continue
        const firstX = this.barToX(first)
        const lastX = this.barToX(last)
        if (firstX === null || lastX === null) continue
        const left = firstX - spacing / 2
        const right = lastX + spacing / 2
        if (right < 0 || left > width) continue
        slices.push({ column, count: 1, left, right })
      }
    }
    this.view.frame = { top, bottom, slices }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
}
