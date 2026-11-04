import {
  STAGES,
  type CheckId,
  type CheckStatus,
  type RunEvent,
  type Stage,
  type Verdict,
} from '../../api/runEvents'

export type CellState = 'WAIT' | 'RUN' | 'DONE' | 'FAIL'

export type StageView = { state: CellState; progress: number; detail: string }

export type RunView = {
  phase: 'idle' | 'connecting' | 'running' | 'done' | 'failed' | 'lost'
  stages: Record<Stage, StageView>
  checks: Partial<Record<CheckId, { status: CheckStatus; figure: string }>>
  verdict: Verdict | null
  failure: { stage: Stage; message: string } | null
  lastSeq: number
}

export function initialRunView(): RunView {
  return {
    phase: 'idle',
    stages: Object.fromEntries(
      STAGES.map((stage) => [stage, { state: 'WAIT', progress: 0, detail: 'queued' }]),
    ) as Record<Stage, StageView>,
    checks: {},
    verdict: null,
    failure: null,
    lastSeq: -1,
  }
}

function withStage(view: RunView, stage: Stage, change: Partial<StageView>): RunView {
  return { ...view, stages: { ...view.stages, [stage]: { ...view.stages[stage], ...change } } }
}

export function reduceRunView(view: RunView, event: RunEvent): RunView {
  if (event.seq <= view.lastSeq) return view
  const next = { ...view, lastSeq: event.seq }
  switch (event.type) {
    case 'run_started':
      return { ...next, phase: 'running' }
    case 'stage_started':
      return withStage(next, event.stage, { state: 'RUN', progress: 0, detail: 'started' })
    case 'stage_progress':
      return withStage(next, event.stage, {
        state: 'RUN',
        progress: event.progress,
        detail: event.detail ?? `${event.progress}%`,
      })
    case 'stage_done':
      return withStage(next, event.stage, {
        state: 'DONE',
        progress: 100,
        detail: event.detail ?? 'done',
      })
    case 'trade_cluster':
      return next
    case 'check_done':
      return { ...next, checks: { ...next.checks, [event.check_id]: { status: event.status, figure: event.figure } } }
    case 'run_done':
      return { ...next, phase: 'done', verdict: event.verdict }
    case 'run_failed':
      return {
        ...withStage(next, event.stage, { state: 'FAIL', detail: 'failed' }),
        phase: 'failed',
        failure: { stage: event.stage, message: event.message },
      }
  }
}

export function overallPercent(view: RunView): number {
  const total = STAGES.reduce((sum, stage) => sum + view.stages[stage].progress, 0)
  return Math.round(total / STAGES.length)
}

export function activeStageIndex(view: RunView): number {
  const running = STAGES.findIndex((stage) => view.stages[stage].state === 'RUN' || view.stages[stage].state === 'FAIL')
  if (running >= 0) return running + 1
  return STAGES.filter((stage) => view.stages[stage].state === 'DONE').length
}

export function describeEvent(event: RunEvent): string {
  switch (event.type) {
    case 'run_started':
      return `run started · ${event.bar_count.toLocaleString('en-US')} bars`
    case 'stage_started':
      return `${event.stage} started`
    case 'stage_progress':
      return `${event.stage} ${event.progress}%${event.detail ? ` · ${event.detail}` : ''}`
    case 'stage_done':
      return `${event.stage} done${event.detail ? ` · ${event.detail}` : ''}`
    case 'trade_cluster':
      return `cluster bars ${event.region.start_bar}–${event.region.end_bar} · ${event.fills} fills`
    case 'check_done':
      return `check ${event.check_id} ${event.status} · ${event.figure}`
    case 'run_done':
      return `run done · verdict ${event.verdict.replace('_', ' ')}`
    case 'run_failed':
      return `run failed at ${event.stage} · ${event.message}`
  }
}
