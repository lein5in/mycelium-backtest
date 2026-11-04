import type { IPrimitivePaneRenderer, IPrimitivePaneView, PrimitivePaneViewZOrder } from 'lightweight-charts'
import { withAlpha, type Theme } from '../../theme/tokens'
import { SeriesPrimitiveBase, type RenderTarget } from './primitiveBase'
import type { Candle } from './types'

const HEIGHT_SHARE = 0.12

export type VolumeColumn = { left: number; width: number; volume: number; up: boolean }

export function volumeColumns(
  candles: readonly Candle[],
  from: number,
  to: number,
  firstX: number,
  spacing: number,
): VolumeColumn[] {
  const columns: VolumeColumn[] = []
  if (spacing >= 1) {
    const width = Math.max(1, spacing * 0.7)
    for (let index = from; index <= to; index += 1) {
      const candle = candles[index]
      if (!candle) continue
      const x = firstX + (index - from) * spacing
      columns.push({ left: x - width / 2, width, volume: candle.volume, up: candle.close >= candle.open })
    }
    return columns
  }
  let pixel = Number.NaN
  let volume = 0
  let ups = 0
  let count = 0
  const flush = () => {
    if (Number.isNaN(pixel)) return
    columns.push({ left: pixel, width: 1, volume, up: ups * 2 >= count })
  }
  for (let index = from; index <= to; index += 1) {
    const candle = candles[index]
    if (!candle) continue
    const column = Math.floor(firstX + (index - from) * spacing)
    if (column !== pixel) {
      flush()
      pixel = column
      volume = 0
      ups = 0
      count = 0
    }
    volume = Math.max(volume, candle.volume)
    count += 1
    if (candle.close >= candle.open) ups += 1
  }
  flush()
  return columns
}

type VolumeFrame = { columns: VolumeColumn[]; peak: number }

class VolumeBarsRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly frame: VolumeFrame | null,
    private readonly theme: Theme,
  ) {}

  draw(target: RenderTarget): void {
    const frame = this.frame
    if (!frame || frame.peak <= 0) return
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const band = mediaSize.height * HEIGHT_SHARE
      const bottom = mediaSize.height
      for (const up of [true, false]) {
        context.beginPath()
        for (const column of frame.columns) {
          if (column.up !== up) continue
          const height = Math.max(1, (column.volume / frame.peak) * band)
          context.rect(column.left, bottom - height, column.width, height)
        }
        context.fillStyle = withAlpha(up ? this.theme.profit : this.theme.loss, 0.45)
        context.fill()
      }
    })
  }
}

class VolumeBarsPaneView implements IPrimitivePaneView {
  frame: VolumeFrame | null = null

  constructor(private readonly owner: VolumeBarsPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom'
  }

  renderer(): IPrimitivePaneRenderer {
    return new VolumeBarsRenderer(this.frame, this.owner.theme)
  }
}

export class VolumeBarsPrimitive extends SeriesPrimitiveBase {
  private candles: readonly Candle[] = []
  private cursor: number | null = null
  private readonly view = new VolumeBarsPaneView(this)

  constructor(readonly theme: Theme) {
    super()
  }

  setCandles(candles: readonly Candle[]): void {
    this.candles = candles
    this.requestUpdate()
  }

  setCursor(cursor: number | null): void {
    this.cursor = cursor
    this.requestUpdate()
  }

  updateAllViews(): void {
    const range = this.chart?.timeScale().getVisibleLogicalRange()
    const last = Math.min(this.candles.length - 1, this.cursor ?? Infinity)
    if (!range || last < 0) {
      this.view.frame = null
      return
    }
    const from = Math.max(0, Math.floor(range.from))
    const to = Math.min(last, Math.ceil(range.to))
    const firstX = this.barToX(from)
    const spacing = this.barSpacing()
    if (firstX === null || spacing <= 0 || to < from) {
      this.view.frame = null
      return
    }
    const columns = volumeColumns(this.candles, from, to, firstX, spacing)
    let peak = 0
    for (const column of columns) if (column.volume > peak) peak = column.volume
    this.view.frame = { columns, peak }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
}
