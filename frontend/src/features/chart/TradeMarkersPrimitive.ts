import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder,
} from 'lightweight-charts'
import { withAlpha, type Theme } from '../../theme/tokens'
import { SeriesPrimitiveBase, type RenderTarget } from './primitiveBase'
import type { ChartTrade } from './types'

const MARKER_SIZE = 5
const TAG_LIMIT = 60

type MarkerGeometry = {
  side: ChartTrade['side']
  outcome: 'win' | 'loss' | 'open'
  entryX: number
  entryY: number
  exitX: number | null
  exitY: number | null
  label: string | null
  selected: boolean
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
        const outcome = marker.outcome === 'win' ? theme.profit : marker.outcome === 'loss' ? theme.loss : theme['text-2']
        const outcomeText =
          marker.outcome === 'win' ? theme['profit-text'] : marker.outcome === 'loss' ? theme['loss-text'] : theme['text-2']
        if (marker.exitX !== null && marker.exitY !== null) {
          context.save()
          context.strokeStyle = withAlpha(outcome, 0.85)
          context.lineWidth = marker.selected ? 1.5 : 1
          context.setLineDash([3, 3])
          context.beginPath()
          context.moveTo(marker.entryX, marker.entryY)
          context.lineTo(marker.exitX, marker.exitY)
          context.stroke()
          context.restore()
        }

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

        if (marker.exitX !== null && marker.exitY !== null) {
          context.fillStyle = outcome
          context.beginPath()
          context.moveTo(marker.exitX, marker.exitY - MARKER_SIZE)
          context.lineTo(marker.exitX + MARKER_SIZE, marker.exitY)
          context.lineTo(marker.exitX, marker.exitY + MARKER_SIZE)
          context.lineTo(marker.exitX - MARKER_SIZE, marker.exitY)
          context.closePath()
          context.fill()
          context.stroke()
        }

        if (marker.selected) {
          context.strokeStyle = theme['accent-text']
          context.lineWidth = 1
          context.strokeRect(marker.entryX - 9.5, marker.entryY - 9.5, 19, 19)
        }

        if (marker.label === null || marker.exitX === null || marker.exitY === null) continue
        const textWidth = context.measureText(marker.label).width
        const tagX = marker.exitX + MARKER_SIZE + 4
        const tagY = marker.exitY - 7
        context.fillStyle = withAlpha(theme['bg-panel'], 0.88)
        context.fillRect(tagX, tagY, textWidth + 8, 14)
        context.strokeStyle = withAlpha(outcome, marker.selected ? 1 : 0.7)
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
  private trades: ChartTrade[] = []
  private selected: number | null = null
  private lastPrice: { price: number; up: boolean } | null = null
  private readonly view = new TradeMarkersPaneView(this)
  private readonly lastPriceView: LastPriceAxisView

  constructor(readonly theme: Theme) {
    super()
    this.lastPriceView = new LastPriceAxisView(theme)
  }

  setTrades(trades: readonly ChartTrade[], firstLogical = 0): void {
    this.trades = trades.map((trade) => ({
      ...trade,
      entryBar: trade.entryBar + firstLogical,
      exitBar: trade.exitBar === null ? null : trade.exitBar + firstLogical,
    }))
    this.requestUpdate()
  }

  setSelected(id: number | null): void {
    this.selected = id
    this.requestUpdate()
  }

  setLastPrice(price: number | null, previous: number | null): void {
    this.lastPrice = price === null ? null : { price, up: previous === null || price >= previous }
    this.requestUpdate()
  }

  updateAllViews(): void {
    const range = this.chart?.timeScale().getVisibleLogicalRange()
    const visible = range
      ? this.trades.filter((trade) => (trade.exitBar ?? trade.entryBar) >= range.from - 1 && trade.entryBar <= range.to + 1)
      : this.trades
    const tagged = visible.length <= TAG_LIMIT
    const markers: MarkerGeometry[] = []
    for (const trade of visible) {
      const entryX = this.barToX(trade.entryBar)
      const entryY = this.priceToY(trade.entryPrice)
      if (entryX === null || entryY === null) continue
      const exitX = trade.exitBar === null ? null : this.barToX(trade.exitBar)
      const exitY = trade.exitPrice === null ? null : this.priceToY(trade.exitPrice)
      const selected = trade.id !== undefined && trade.id === this.selected
      const outcome = trade.pnl === null ? 'open' : trade.pnl > 0 ? 'win' : 'loss'
      markers.push({
        side: trade.side,
        outcome,
        entryX,
        entryY,
        exitX,
        exitY,
        label: trade.pnl !== null && (tagged || selected) ? formatPnl(trade.pnl) : null,
        selected,
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
