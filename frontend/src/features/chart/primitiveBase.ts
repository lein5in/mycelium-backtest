import type {
  IChartApi,
  IPrimitivePaneRenderer,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'

export type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0]

export type BitmapScope = Parameters<Parameters<RenderTarget['useBitmapCoordinateSpace']>[0]>[0]

export abstract class SeriesPrimitiveBase implements ISeriesPrimitive<Time> {
  protected chart: IChartApi | null = null
  protected series: ISeriesApi<SeriesType> | null = null
  private requestUpdateCallback: (() => void) | null = null

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi
    this.series = param.series
    this.requestUpdateCallback = param.requestUpdate
    this.requestUpdate()
  }

  detached(): void {
    this.chart = null
    this.series = null
    this.requestUpdateCallback = null
  }

  protected requestUpdate(): void {
    this.requestUpdateCallback?.()
  }

  protected barToX(logical: number): number | null {
    if (!this.chart) return null
    return this.chart.timeScale().logicalToCoordinate(logical as never)
  }

  protected barSpacing(): number {
    const a = this.barToX(0)
    const b = this.barToX(1)
    return a === null || b === null ? 0 : b - a
  }

  protected priceToY(price: number): number | null {
    return this.series ? this.series.priceToCoordinate(price) : null
  }
}
