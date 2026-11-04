import type { RunResultPayload } from '../../api/result'
import { VERDICT_CLASSES, VERDICT_LABELS } from './format'
import { kpisOf } from './reportModel'

export function KpiStrip({ payload }: { payload: RunResultPayload }) {
  const verdict = payload.report.verdict.id
  return (
    <dl aria-label="Key figures" className="m-0 grid grid-cols-2 border-b border-line bg-panel sm:grid-cols-4 xl:grid-cols-7">
      {kpisOf(payload).map((kpi) => (
        <div key={kpi.label} className="flex min-w-0 flex-col gap-0.5 border-r border-b border-line px-3 py-2 xl:border-b-0">
          <dt className="label-caps text-ink-3">{kpi.label}</dt>
          <dd className={`m-0 font-mono text-[19px] font-semibold tabular-nums ${kpi.tone}`} data-testid={`kpi-${kpi.label}`}>
            {kpi.value}
          </dd>
          {kpi.note && <dd className="m-0 truncate font-mono text-[11px] text-ink-3">{kpi.note}</dd>}
        </div>
      ))}
      <div className="flex min-w-0 flex-col gap-1 border-b border-line px-3 py-2 xl:border-b-0">
        <dt className="label-caps text-ink-3">Honesty verdict</dt>
        <dd className="m-0">
          <span data-testid="verdict" className={`inline-flex border px-2 py-0.5 font-mono text-[14px] font-semibold tracking-[0.1em] ${VERDICT_CLASSES[verdict]}`}>
            {VERDICT_LABELS[verdict]}
          </span>
        </dd>
      </div>
    </dl>
  )
}
