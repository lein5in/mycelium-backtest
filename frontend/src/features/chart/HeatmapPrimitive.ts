import type { IPrimitivePaneRenderer, IPrimitivePaneView, PrimitivePaneViewZOrder } from 'lightweight-charts'
import { heatmapPixels, type Rgb } from './heatmapColor'
import { SeriesPrimitiveBase, type RenderTarget } from './primitiveBase'
import type { HeatmapGrid } from './types'

type Rect = { left: number; top: number; width: number; height: number }

class HeatmapRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly image: HTMLCanvasElement | null,
    private readonly rect: Rect | null,
  ) {}

  draw(target: RenderTarget): void {
    const { image, rect } = this
    if (!image || !rect || rect.width <= 0 || rect.height <= 0) return
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const left = Math.round(rect.left * horizontalPixelRatio)
      const top = Math.round(rect.top * verticalPixelRatio)
      const right = Math.round((rect.left + rect.width) * horizontalPixelRatio)
      const bottom = Math.round((rect.top + rect.height) * verticalPixelRatio)
      context.imageSmoothingEnabled = false
      context.drawImage(image, 0, 0, image.width, image.height, left, top, right - left, bottom - top)
    })
  }
}

class HeatmapPaneView implements IPrimitivePaneView {
  rect: Rect | null = null

  constructor(private readonly owner: HeatmapPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom'
  }

  renderer(): IPrimitivePaneRenderer {
    return new HeatmapRenderer(this.owner.image, this.rect)
  }
}

export class HeatmapPrimitive extends SeriesPrimitiveBase {
  image: HTMLCanvasElement | null = null
  private grid: HeatmapGrid | null = null
  private firstLogical = 0
  private readonly view = new HeatmapPaneView(this)

  setGrid(grid: HeatmapGrid, firstLogical: number, ramp: readonly Rgb[]): void {
    this.grid = grid
    this.firstLogical = firstLogical
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

  updateAllViews(): void {
    const grid = this.grid
    if (!grid) return
    const spacing = this.barSpacing()
    const firstX = this.barToX(this.firstLogical)
    const top = this.priceToY(grid.lowest_price + grid.rows * grid.price_bucket)
    const bottom = this.priceToY(grid.lowest_price)
    if (firstX === null || top === null || bottom === null || spacing <= 0) {
      this.view.rect = null
      return
    }
    this.view.rect = {
      left: firstX - spacing / 2,
      top,
      width: grid.columns * spacing,
      height: bottom - top,
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
}
