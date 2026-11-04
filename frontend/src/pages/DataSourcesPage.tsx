import { useEffect, useState } from 'react'
import { getMarkets } from '../api/client'
import { describeError } from '../api/errorMessages'
import type { Markets } from '../api/types'
import { MARKET_LABELS } from '../features/config/configModel'
import { DataSourcesContent } from '../site/DataSourcesContent'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { ErrorPanel, SkeletonRows } from '../ui/States'
import { Table } from '../ui/Table'
import { ModeBadge } from '../ui/Tag'

type Load = { status: 'loading' } | { status: 'ready'; markets: Markets } | { status: 'error'; error: unknown }

export function DataSourcesPage() {
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    getMarkets({ signal: controller.signal })
      .then((markets) => setLoad({ status: 'ready', markets }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', error })
      })
    return () => controller.abort()
  }, [attempt])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
      <div className="flex max-w-prose flex-col gap-1 px-1">
        <h1 className="m-0 text-[22px] font-semibold text-ink">Data sources</h1>
        <p className="m-0 text-[13px] leading-relaxed text-ink-2">
          Every dataset shows where it comes from. Synthetic sets are labelled SAMPLE DATA and are not real prices. Your
          own CSV files are processed in memory and not kept.
        </p>
      </div>
      <Panel label="Sources offered here">
        {load.status === 'loading' && <SkeletonRows label="Loading data sources" />}
        {load.status === 'error' && (
          <ErrorPanel
            error={describeError(load.error)}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setLoad({ status: 'loading' })
                  setAttempt((value) => value + 1)
                }}
              >
                Try again
              </Button>
            }
          />
        )}
        {load.status === 'ready' && (
          <Table
            caption="Data sources"
            rows={load.markets.providers}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'name',
                header: 'Source',
                className: 'min-w-[180px]',
                render: (row) => (
                  <span className="flex flex-col items-start gap-1">
                    <span className="font-medium text-ink">{row.display_name}</span>
                    <ModeBadge mode={row.mode} />
                  </span>
                ),
              },
              {
                key: 'markets',
                header: 'Markets',
                render: (row) => (
                  <span className="font-mono text-[11.5px] whitespace-nowrap text-ink-2">
                    {row.markets.map((market) => MARKET_LABELS[market]).join(', ')}
                  </span>
                ),
              },
              {
                key: 'licence',
                header: 'Licence note',
                className: 'min-w-[260px]',
                render: (row) => <span className="text-[12.5px] leading-snug text-ink-2">{row.note}</span>,
              },
              {
                key: 'attribution',
                header: 'Attribution',
                className: 'min-w-[220px]',
                render: (row) => (
                  <span className="flex flex-col gap-1 text-[12.5px] leading-snug text-ink-2">
                    {row.attribution}
                    {row.terms_url && (
                      <a href={row.terms_url} target="_blank" rel="noreferrer" className="text-accent-text underline">
                        Terms
                      </a>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Panel>
      <Panel label="Sources, attribution and terms">
        <div className="px-3">
          <DataSourcesContent />
        </div>
      </Panel>
    </div>
  )
}
