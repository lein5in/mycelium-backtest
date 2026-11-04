import { Link } from 'react-router'
import { EmptyState } from '../ui/States'

export function NotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-app px-4 py-10">
      <div className="mx-auto w-full max-w-[560px] border border-line bg-panel">
        <p className="label-caps m-0 border-b border-line bg-panel-head px-4 py-2 text-ink-3">404</p>
        <EmptyState
          title="This page does not exist"
          action={
            <Link className="text-[13px] text-accent-text underline" to="/app">
              Go to a new run
            </Link>
          }
        >
          The address may be mistyped, or the page has moved.
        </EmptyState>
      </div>
    </div>
  )
}
