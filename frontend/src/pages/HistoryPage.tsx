import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { history as defaultHistory, HISTORY_MESSAGES, HistoryError, type HistoryEntry, type HistoryStore } from '../features/history/historyStore'
import { money, toneOf, VERDICT_CLASSES, VERDICT_LABELS } from '../features/report/format'
import { MARKET_LABELS } from '../features/config/configModel'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { EmptyState, SkeletonRows } from '../ui/States'
import { ModeBadge } from '../ui/Tag'

type Load = { status: 'loading' } | { status: 'ready'; entries: HistoryEntry[] } | { status: 'error'; message: string }

const PRIVACY_LINE = 'History lives only in this browser. It is never sent anywhere, and CSV file contents are never stored.'

function when(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16) + ' UTC'
}

export function HistoryPage({ store = defaultHistory }: { store?: HistoryStore }) {
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const refresh = useCallback(() => {
    store
      .list()
      .then((entries) => setLoad({ status: 'ready', entries }))
      .catch((error: unknown) =>
        setLoad({ status: 'error', message: error instanceof HistoryError ? error.message : HISTORY_MESSAGES.failed }),
      )
  }, [store])

  useEffect(() => {
    refresh()
  }, [refresh])

  const act = async (action: () => Promise<void>, done: string) => {
    try {
      await action()
      setNotice(done)
    } catch (error) {
      setNotice(error instanceof HistoryError ? error.message : HISTORY_MESSAGES.failed)
    }
    refresh()
  }

  const entries = load.status === 'ready' ? load.entries : []

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[22px] font-semibold text-ink">History</h1>
          <p className="m-0 text-[13px] text-ink-2" data-testid="history-privacy">
            {PRIVACY_LINE}
          </p>
        </div>
        {entries.length > 0 &&
          (confirmClear ? (
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              Delete every saved run?
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmClear(false)
                  void act(() => store.clear(), 'History cleared.')
                }}
              >
                Clear all
              </Button>
              <Button onClick={() => setConfirmClear(false)}>Keep</Button>
            </span>
          ) : (
            <Button onClick={() => setConfirmClear(true)}>Clear all</Button>
          ))}
      </div>
      {notice && (
        <p role="status" className="m-0 border-l-2 border-accent bg-panel px-3 py-1.5 text-[13px] text-ink-2">
          {notice}
        </p>
      )}
      <Panel label={`Saved runs${entries.length ? ` · ${entries.length}` : ''}`}>
        {load.status === 'loading' && <SkeletonRows label="Loading history" />}
        {load.status === 'error' && (
          <EmptyState title="History is not available" action={<Link className="text-[13px] text-accent-text underline" to="/app">Configure a run</Link>}>
            {load.message}
          </EmptyState>
        )}
        {load.status === 'ready' && entries.length === 0 && (
          <EmptyState
            title="No runs saved in this browser yet"
            action={
              <Link
                to="/app"
                className="inline-flex min-h-[34px] items-center border border-accent bg-accent px-3 font-mono text-xs font-medium tracking-[0.06em] text-app uppercase hover:brightness-110"
              >
                Configure a run
              </Link>
            }
          >
            {PRIVACY_LINE} Finished runs appear here with their strategy, market, source, date, verdict and net result.
          </EmptyState>
        )}
        {entries.length > 0 && (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-[13px]" data-testid="history-table">
              <caption className="sr-only-text">Runs saved in this browser</caption>
              <thead>
                <tr className="bg-panel-head">
                  {['Strategy', 'Market · symbol', 'Source', 'Date', 'Verdict', 'Net P&L', ''].map((header, index) => (
                    <th
                      key={header || 'actions'}
                      scope="col"
                      className={`label-caps border-b border-line-strong px-3 py-1.5 font-medium whitespace-nowrap text-ink-3 ${index === 5 ? 'text-right' : 'text-left'}`}
                    >
                      {header || <span className="sr-only-text">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-line hover:bg-hover">
                    <td className="px-3 py-1.5 text-ink">{entry.strategyName}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px] whitespace-nowrap text-ink-2">
                      {MARKET_LABELS[entry.market as keyof typeof MARKET_LABELS] ?? entry.market} · {entry.symbol}
                      {entry.timeframe ? ` · ${entry.timeframe}` : ''}
                    </td>
                    <td className="px-3 py-1.5">{entry.sourceMode ? <ModeBadge mode={entry.sourceMode} /> : '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px] whitespace-nowrap text-ink-2">{when(entry.savedAt)}</td>
                    <td className="px-3 py-1.5">
                      {entry.verdict ? (
                        <span className={`border px-1.5 py-0.5 font-mono text-[11px] tracking-[0.08em] ${VERDICT_CLASSES[entry.verdict]}`}>
                          {VERDICT_LABELS[entry.verdict]}
                        </span>
                      ) : (
                        <span className="font-mono text-[11.5px] text-ink-3">{entry.status === 'running' ? 'not finished' : entry.status}</span>
                      )}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono text-data tabular-nums ${toneOf(entry.netPnl)}`}>{money(entry.netPnl)}</td>
                    <td className="px-3 py-1.5">
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {entry.status === 'done' && (
                          <Link
                            to={`/app/results/${entry.id}`}
                            className="inline-flex min-h-[30px] items-center border border-line-strong px-2 font-mono text-[11px] tracking-[0.06em] text-ink uppercase hover:bg-hover"
                            title={entry.resultBytes ? 'Opens the copy kept in this browser if the server has purged the run' : (entry.resultNote ?? undefined)}
                          >
                            Open
                          </Link>
                        )}
                        <Button className="min-h-[30px] px-2 text-[11px]" onClick={() => navigate('/app', { state: { request: entry.request } })}>
                          Run again
                        </Button>
                        <Button
                          className="min-h-[30px] px-2 text-[11px]"
                          aria-label={`Delete ${entry.strategyName} ${entry.symbol} from history`}
                          onClick={() => void act(() => store.remove(entry.id), 'Run deleted from history.')}
                        >
                          Delete
                        </Button>
                      </span>
                      {entry.status === 'done' && !entry.resultBytes && (
                        <span className="mt-0.5 block text-right font-mono text-[10.5px] text-ink-3">summary only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
