import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder,
} from 'lightweight-charts'
import { withAlpha, type Theme } from '../../theme/tokens'
import { SeriesPrimitiveBase, type RenderTarget } from './primitiveBase'
import type { SampleTrade } from './types'

const MARKER_SIZE = 5

type MarkerGeometry = {
  side: SampleTrade['side']
  win: boolean
  entryX: number
  entryY: number
  exitX: number
  exitY: number
  label: string
}

export function formatPnl(pnl: number): string {
  const sign = pnl > 0 ? '+' : pnl < 0 ? '−' : ''
  return `${sign}${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

class TradeMarkersRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly markers: MarkerGeometry[],
    private readonly theme: Theme,
  ) {}

  draw(target: RenderTarget): void {
    const theme = this.theme
    target.useMediaCoordinateSpace(({ context }) => {
      context.font = '500 10px "IBM Plex Mono", monospace'
      context.textBaseline = 'middle'
      for (const marker of this.markers) {
        const outcome = marker.win ? theme.profit : theme.loss
        const outcomeText = marker.win ? theme['profit-text'] : theme['loss-text']
        context.save()
        context.strokeStyle = withAlpha(outcome, 0.85)
        context.lineWidth = 1
        context.setLineDash([3, 3])
        context.beginPath()
        context.moveTo(marker.entryX, marker.entryY)
        context.lineTo(marker.exitX, marker.exitY)
        context.stroke()
        context.restore()

        const direction = marker.side === 'long' ? -1 : 1
        context.fillStyle = theme.accent
        context.strokeStyle = theme['bg-app']
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(marker.entryX, marker.entryY + direction * MARKER_SIZE * 1.1)
        context.lineTo(marker.entryX - MARKER_SIZE, marker.entryY - direction * MARKER_SIZE * 0.7)
        context.lineTo(marker.entryX + MARKER_SIZE, marker.entryY - direction * MARKER_SIZE * 0.7)
        context.closePath()
        context.fill()
        context.stroke()

        context.fillStyle = outcome
        context.beginPath()
        context.moveTo(marker.exitX, marker.exitY - MARKER_SIZE)
        context.lineTo(marker.exitX + MARKER_SIZE, marker.exitY)
        context.lineTo(marker.exitX, marker.exitY + MARKER_SIZE)
        context.lineTo(marker.exitX - MARKER_SIZE, marker.exitY)
        context.closePath()
        context.fill()
        context.stroke()

        const textWidth = context.measureText(marker.label).width
        const tagX = marker.exitX + MARKER_SIZE + 4
        const tagY = marker.exitY - 7
        context.fillStyle = withAlpha(theme['bg-panel'], 0.88)
        context.fillRect(tagX, tagY, textWidth + 8, 14)
        context.strokeStyle = withAlpha(outcome, 0.7)
        context.strokeRect(tagX + 0.5, tagY + 0.5, textWidth + 7, 13)
        context.fillStyle = outcomeText
        context.textAlign = 'left'
        context.fillText(marker.label, tagX + 4, tagY + 7.5)
      }
    })
  }
}

class TradeMarkersPaneView implements IPrimitivePaneView {
  markers: MarkerGeometry[] = []

  constructor(private readonly owner: TradeMarkersPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'top'
  }

  renderer(): IPrimitivePaneRenderer {
    return new TradeMarkersRenderer(this.markers, this.owner.theme)
  }
}

class LastPriceAxisView implements ISeriesPrimitiveAxisView {
  y = 0
  label = ''
  up = true
  shown = false

  constructor(private readonly theme: Theme) {}

  coordinate(): number {
    return this.y
  }

  text(): string {
    return this.label
  }

  textColor(): string {
    return this.theme['bg-app']
  }

  backColor(): string {
    return this.up ? this.theme.profit : this.theme.loss
  }

  visible(): boolean {
    return this.shown
  }
}

export class TradeMarkersPrimitive extends SeriesPrimitiveBase {
  private trades: SampleTrade[] = []
  private lastPrice: { price: number; up: boolean } | null = null
  private readonly view = new TradeMarkersPaneView(this)
  private readonly lastPriceView: LastPriceAxisView

  constructor(readonly theme: Theme) {
    super()
    this.lastPriceView = new LastPriceAxisView(theme)
  }

  setTrades(trades: SampleTrade[], firstLogical: number): void {
    this.trades = trades.map((trade) => ({
      ...trade,
      entryBar: trade.entryBar + firstLogical,
      exitBar: trade.exitBar + firstLogical,
    }))
    this.requestUpdate()
  }

  setLastPrice(price: number, previous: number): void {
    this.lastPrice = { price, up: price >= previous }
    this.requestUpdate()
  }

  updateAllViews(): void {
    const markers: MarkerGeometry[] = []
    for (const trade of this.trades) {
      const entryX = this.barToX(trade.entryBar)
      const exitX = this.barToX(trade.exitBar)
      const entryY = this.priceToY(trade.entryPrice)
      const exitY = this.priceToY(trade.exitPrice)
      if (entryX === null || exitX === null || entryY === null || exitY === null) continue
      markers.push({
        side: trade.side,
        win: trade.pnl > 0,
        entryX,
        entryY,
        exitX,
        exitY,
        label: formatPnl(trade.pnl),
      })
    }
    this.view.markers = markers
    const last = this.lastPrice
    const y = last ? this.priceToY(last.price) : null
    this.lastPriceView.shown = last !== null && y !== null
    if (last && y !== null) {
      this.lastPriceView.y = y
      this.lastPriceView.label = last.price.toFixed(2)
      this.lastPriceView.up = last.up
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return [this.lastPriceView]
  }
}
