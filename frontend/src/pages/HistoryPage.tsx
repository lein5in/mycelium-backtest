import { Link } from 'react-router'
import { Panel } from '../ui/Panel'
import { EmptyState } from '../ui/States'

export function HistoryPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col p-3">
      <h1 className="sr-only-text">History</h1>
      <Panel label="History">
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
          History lives only in this browser: nothing is stored on our servers. Finished runs will appear here with their
          strategy, market, date, verdict and net result.
        </EmptyState>
      </Panel>
    </div>
  )
}
