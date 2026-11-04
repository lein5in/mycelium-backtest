import type { RunRequestDocument } from '../../api/result'
import type { StrategyMetadata } from '../../api/types'
import { PropertyGrid, PropertyRow } from '../../ui/PropertyGrid'
import { costRows, DASH, parameterRows } from './requestRows'

type RequestDockProps = {
  request: RunRequestDocument | null
  strategy: StrategyMetadata | undefined
  parameters: Record<string, number | string> | null
}


export function RequestDock({ request, strategy, parameters }: RequestDockProps) {
  const params = parameterRows(request, strategy, parameters)
  const costs = costRows(request)
  const source = request?.data
    ? `${request.data.provider} · ${request.data.symbol} · ${request.data.timeframe} · ${request.data.start.slice(0, 10)} → ${request.data.end.slice(0, 10)}`
    : request?.csv
      ? `CSV import · ${request.csv.market === 'us_equity' ? 'Stocks & ETFs' : 'Crypto'}`
      : null
  return (
    <>
      <section aria-labelledby="dock-strategy" className="flex flex-col bg-panel">
        <h2 id="dock-strategy" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
          Strategy · parameters
        </h2>
        <p className="m-0 border-b border-line px-3 py-1.5 text-[13px] font-medium text-ink">
          {strategy?.name ?? request?.strategy_id ?? DASH}
        </p>
        {source && <p className="m-0 border-b border-line px-3 py-1.5 font-mono text-[11.5px] break-words text-ink-3">{source}</p>}
        {params.length > 0 ? (
          <PropertyGrid label="Strategy parameters">
            {params.map((row) => (
              <PropertyRow key={row.label} label={row.label}>
                {row.value}
              </PropertyRow>
            ))}
          </PropertyGrid>
        ) : (
          <p className="m-0 px-3 py-2 text-[12.5px] text-ink-3">{request ? 'Parameters arrive with the result.' : DASH}</p>
        )}
      </section>
      <section aria-labelledby="dock-costs" className="flex flex-col bg-panel">
        <h2 id="dock-costs" className="label-caps m-0 flex min-h-8 items-center border-b border-line bg-panel-head px-3 font-medium text-ink-3">
          Costs · risk
        </h2>
        {costs.length > 0 ? (
          <PropertyGrid label="Costs and risk">
            {costs.map((row) => (
              <PropertyRow key={row.label} label={row.label}>
                {row.value}
              </PropertyRow>
            ))}
          </PropertyGrid>
        ) : (
          <p className="m-0 px-3 py-2 text-[12.5px] text-ink-3">{DASH}</p>
        )}
      </section>
    </>
  )
}
