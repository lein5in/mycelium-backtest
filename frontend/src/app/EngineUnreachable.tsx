import { describeError } from '../api/errorMessages'
import { ApiError } from '../api/client'
import { Button } from '../ui/Button'
import { ErrorPanel } from '../ui/States'
import type { EngineState } from './context'
import { DOWN_INTERVAL_MS } from './useHealth'

export function EngineUnreachable({ engine }: { engine: EngineState }) {
  const error = describeError(
    new ApiError({ code: 'engine_unreachable', status: 0, message: 'The backtest engine did not answer the health check.' }),
  )
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10">
      <div className="flex w-full max-w-[560px] flex-col gap-3">
        <h1 className="m-0 text-[22px] font-semibold text-ink">The engine is unreachable</h1>
        <ErrorPanel
          error={{ ...error, action: `${error.action} Next check in ${DOWN_INTERVAL_MS / 1000} s.` }}
          action={
            <Button variant="primary" onClick={engine.recheck} disabled={engine.status === 'checking'}>
              {engine.status === 'checking' ? 'Checking' : 'Check now'}
            </Button>
          }
        />
        <p className="m-0 text-[13px] text-ink-2">
          Your history in this browser is still available under History.
        </p>
      </div>
    </div>
  )
}
