import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { cancelRun, getRunStatus } from '../api/client'
import { describeError, describeRunFailure, type DescribedError } from '../api/errorMessages'
import { STAGES, type RunEvent } from '../api/runEvents'
import type { RunStatusDocument } from '../api/types'
import { useRunStream, type Connection } from '../features/run/useRunStream'
import { describeEvent, initialRunView, reduceRunView, type CellState } from '../spikes/runState'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { ErrorPanel, LoadingLine } from '../ui/States'
import { Tag, type TagState } from '../ui/Tag'

const VERDICT_CLASSES: Record<string, string> = {
  CREDIBLE: 'border-profit text-profit-text',
  FRAGILE: 'border-warn text-warn-text',
  NOT_CREDIBLE: 'border-loss text-loss-text',
}

const CELL_TAG: Record<CellState, TagState> = { WAIT: 'WAIT', RUN: 'RUN', DONE: 'DONE', FAIL: 'FAIL' }

const CONNECTION_TEXT: Record<Connection, string> = {
  connecting: 'connecting to the event stream',
  open: 'receiving events',
  reconnecting: 'connection lost, reconnecting from the last event received',
  closed: 'stream complete',
  lost: 'stream closed',
}

const LOG_LIMIT = 400

export function RunPage() {
  const { id = '' } = useParams()
  const stream = useRunStream(id)
  const [status, setStatus] = useState<RunStatusDocument | null>(null)
  const [statusError, setStatusError] = useState<DescribedError | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const view = useMemo(() => stream.events.reduce(reduceRunView, initialRunView()), [stream.events])
  const last: RunEvent | undefined = stream.events.at(-1)
  const finished = last?.type === 'run_done' || last?.type === 'run_failed'

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      getRunStatus(id, { signal: controller.signal })
        .then((document) => {
          setStatus(document)
          setStatusError(null)
          if (document.status === 'queued' || document.status === 'running') timer = setTimeout(load, 2_000)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setStatusError(describeError(error))
        })
    }
    load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [id, finished])

  const failure =
    last?.type === 'run_failed'
      ? describeRunFailure(last.code, last.message, last.stage)
      : status?.error
        ? describeRunFailure(status.error.code, status.error.message, status.error.stage)
        : null
  const verdict = last?.type === 'run_done' ? last.verdict : status?.verdict
  const terminalState =
    last?.type === 'run_done' ? 'done' : last?.type === 'run_failed' ? (last.code === 'run_cancelled' ? 'cancelled' : 'failed') : null
  const state = terminalState ?? (statusError?.code === 'run_not_found' ? 'not found' : (status?.status ?? 'connecting'))
  const currentStage = STAGES.find((stage) => view.stages[stage].state === 'RUN') ?? status?.stage ?? '—'

  const cancel = async () => {
    setCancelling(true)
    try {
      setStatus(await cancelRun(id))
    } catch (error) {
      setStatusError(describeError(error))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel-head px-3 py-2">
        <h1 className="m-0 text-[16px] font-semibold text-ink">Run</h1>
        <span className="font-mono text-[12px] break-all text-ink-3">{id}</span>
        <span className="border border-warn px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-warn-text uppercase">
          Temporary view
        </span>
        <span className="ml-auto flex items-center gap-2">
          {verdict && (
            <span data-testid="verdict" className={`border px-2 py-0.5 font-mono text-[12px] tracking-[0.1em] ${VERDICT_CLASSES[verdict] ?? ''}`}>
              {verdict.replace('_', ' ')}
            </span>
          )}
          {!finished && status && (status.status === 'queued' || status.status === 'running') && (
            <Button onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? 'Cancelling' : 'Cancel run'}
            </Button>
          )}
        </span>
      </div>
      <p className="m-0 border-b border-line px-3 py-2 text-[12.5px] text-ink-2">
        This page shows the engine events as they arrive. The run screen with the chart and the full results come in the
        next release.
      </p>

      <p aria-live="polite" className="sr-only-text">
        {failure ? `Run failed at stage ${failure.stage ?? 'unknown'}.` : verdict ? `Run finished, verdict ${verdict.replace('_', ' ')}.` : `Stage ${currentStage}.`}
      </p>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-px bg-app">
          <Panel label="Status">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 px-3 py-2 font-mono text-data">
              <dt className="text-ink-3">State</dt>
              <dd data-testid="run-state" className="m-0 text-ink">{state}</dd>
              <dt className="text-ink-3">Current stage</dt>
              <dd className="m-0 text-ink">{finished ? '—' : currentStage}</dd>
              <dt className="text-ink-3">Stream</dt>
              <dd className="m-0 text-ink-2">{CONNECTION_TEXT[stream.connection]}</dd>
              <dt className="text-ink-3">Events</dt>
              <dd className="m-0 text-ink-2">{stream.events.length}</dd>
            </dl>
            {stream.unreadable > 0 && (
              <p className="m-0 border-t border-line px-3 py-2 text-[12.5px] text-warn-text">
                {stream.unreadable} event(s) could not be read and were skipped.
              </p>
            )}
          </Panel>
          <Panel label="Stages">
            <ol className="m-0 grid list-none grid-cols-2 p-0 sm:grid-cols-3 2xl:grid-cols-6">
              {STAGES.map((stage) => {
                const cell = view.stages[stage]
                return (
                  <li key={stage} className="flex min-w-0 flex-col gap-1 border-r border-b border-line px-3 py-2">
                    <span className="flex items-center justify-between gap-2">
                      <span className="label-caps text-ink-2">{stage}</span>
                      <Tag state={CELL_TAG[cell.state]} />
                    </span>
                    <span className="font-mono text-[11.5px] break-words text-ink-3">{cell.detail}</span>
                  </li>
                )
              })}
            </ol>
          </Panel>
          {Object.keys(view.checks).length > 0 && (
            <Panel label="Honesty checks">
              <ul className="m-0 list-none p-0">
                {Object.entries(view.checks).map(([checkId, check]) => (
                  <li key={checkId} className="flex items-start gap-3 border-b border-line px-3 py-1.5 last:border-b-0">
                    <Tag state={check?.status ?? 'WAIT'} />
                    <span className="font-mono text-[12px] text-ink-2">{checkId}</span>
                    <span className="text-[12.5px] text-ink">{check?.figure}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {failure && <ErrorPanel error={failure} action={<Link className="text-[13px] text-accent-text underline" to="/app">Back to configuration</Link>} />}
          {statusError && !failure && (
            <ErrorPanel
              error={statusError}
              action={<Link className="text-[13px] text-accent-text underline" to="/app">Start a new run</Link>}
            />
          )}
          {verdict && !failure && (
            <p className="m-0 bg-panel px-3 py-3 text-[13px] text-ink-2">
              The run finished with the verdict {verdict.replace('_', ' ')}. The full result view is part of the next release.
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col bg-app">
          <Panel label={`Event log · ${stream.events.length}`} className="min-h-[320px] flex-1" bodyClassName="flex flex-col">
            {stream.events.length === 0 && !failure && <LoadingLine label="Waiting for the first engine event" />}
            <ol aria-label="Engine events" className="m-0 max-h-[70vh] min-h-0 flex-1 list-none overflow-y-auto p-0 font-mono text-[11.5px]">
              {stream.events.slice(-LOG_LIMIT).map((event) => (
                <li
                  key={event.seq}
                  className={`flex gap-2 border-b border-line px-3 py-1 ${event.type === 'run_failed' ? 'text-loss-text' : 'text-ink-2'}`}
                >
                  <span className="w-7 shrink-0 text-right text-ink-3 tabular-nums">{event.seq}</span>
                  <span className="min-w-0 break-words">{describeEvent(event)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  )
}
