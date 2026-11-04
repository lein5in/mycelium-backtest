import type { MarketKind, StrategyMetadata } from '../../api/types'
import { Table } from '../../ui/Table'
import { Tag } from '../../ui/Tag'
import { compatibility, MARKET_LABELS } from '../config/configModel'

type StrategyLibraryProps = {
  strategies: StrategyMetadata[]
  market: MarketKind
  selectedId: string
  onSelect: (id: string) => void
}

export function StrategyLibrary({ strategies, market, selectedId, onSelect }: StrategyLibraryProps) {
  return (
    <Table
      caption={`Strategy library for ${MARKET_LABELS[market]}`}
      rows={strategies}
      rowKey={(row) => row.id}
      selectedKey={selectedId}
      rowClassName={(row) => (compatibility(row, market).ok ? '' : 'text-ink-3')}
      columns={[
        {
          key: 'name',
          header: 'Strategy',
          className: 'min-w-[220px]',
          render: (row) => {
            const compatible = compatibility(row, market)
            const soon = row.id === 'custom'
            const reasonId = `strategy-${row.id}-reason`
            return (
              <div className="flex flex-col items-start gap-1">
                <button
                  type="button"
                  aria-pressed={row.id === selectedId}
                  aria-describedby={compatible.ok ? undefined : reasonId}
                  disabled={!compatible.ok}
                  onClick={() => onSelect(row.id)}
                  className="inline-flex min-h-[30px] items-center gap-2 text-left text-[13.5px] font-medium text-ink hover:text-accent-text disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:text-ink-3"
                >
                  {row.name}
                  {soon && <Tag state="SOON" />}
                </button>
                <span className="text-[12.5px] leading-snug text-ink-2">{row.summary}</span>
                {!compatible.ok && !soon && (
                  <span id={reasonId} className="font-mono text-[11px] leading-snug text-warn-text">
                    {compatible.reason}
                  </span>
                )}
                {soon && (
                  <span id={reasonId} className="font-mono text-[11px] leading-snug text-ink-3">
                    {compatible.ok ? '' : compatible.reason}
                  </span>
                )}
              </div>
            )
          },
        },
        {
          key: 'markets',
          header: 'Markets',
          render: (row) => (
            <span className="flex flex-col gap-0.5 font-mono text-[11.5px] whitespace-nowrap text-ink-2">
              {row.markets.map((item) => (
                <span key={item} className={item === market ? 'text-ink' : ''}>
                  {MARKET_LABELS[item]}
                </span>
              ))}
            </span>
          ),
        },
        {
          key: 'timeframes',
          header: 'Timeframes',
          render: (row) => <span className="font-mono text-[11.5px] text-ink-2">{row.timeframes.join(' ')}</span>,
        },
      ]}
    />
  )
}
