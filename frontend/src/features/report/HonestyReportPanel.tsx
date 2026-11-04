import type { HonestyReport } from '../../api/result'
import { Tag } from '../../ui/Tag'
import { CHECK_LABELS, VERDICT_CLASSES, VERDICT_LABELS } from './format'
import { checkTag, failingChecks } from './reportModel'

function configValue(value: number | string | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return value
}

export function HonestyReportPanel({ report }: { report: HonestyReport }) {
  const verdict = report.verdict
  const failing = failingChecks(report)
  const warned = report.checks.filter((check) => check.status === 'WARN').map((check) => CHECK_LABELS[check.id])
  return (
    <div className="flex flex-col">
      <table className="w-full border-collapse text-[12.5px]">
        <caption className="sr-only-text">The six honesty checks</caption>
        <thead>
          <tr className="bg-panel-head">
            <th scope="col" className="label-caps border-b border-line-strong px-3 py-1.5 text-left font-medium text-ink-3">
              State
            </th>
            <th scope="col" className="label-caps border-b border-line-strong px-3 py-1.5 text-left font-medium text-ink-3">
              Check
            </th>
            <th scope="col" className="label-caps border-b border-line-strong px-3 py-1.5 text-left font-medium text-ink-3">
              Key figure
            </th>
          </tr>
        </thead>
        <tbody>
          {report.checks.map((check) => {
            const tag = checkTag(check)
            return (
              <tr key={check.id} className="border-b border-line align-top">
                <td className="px-3 py-1.5">
                  <Tag state={tag.state} label={tag.label} />
                  {tag.note && <span className="mt-1 block font-mono text-[10.5px] whitespace-nowrap text-warn-text">{tag.note}</span>}
                </td>
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-ink">
                  {CHECK_LABELS[check.id]}
                </th>
                <td className="px-3 py-1.5 text-ink-2">
                  <span className="text-ink">{check.headline}</span>
                  <details className="mt-0.5">
                    <summary className="cursor-pointer font-mono text-[11px] text-ink-3">detail</summary>
                    <p className="m-0 mt-1 text-[12px] leading-relaxed text-ink-2">{check.detail}</p>
                  </details>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="flex flex-col gap-2 border-b border-line px-3 py-3">
        <p className="m-0 flex items-center gap-2">
          <span className="label-caps text-ink-3">Verdict</span>
          <span className={`border px-2 py-0.5 font-mono text-[12px] font-semibold tracking-[0.1em] ${VERDICT_CLASSES[verdict.id]}`}>
            {VERDICT_LABELS[verdict.id]}
          </span>
        </p>
        <p className="m-0 text-[13px] leading-relaxed text-ink-2" data-testid="verdict-explanation">
          {failing.length > 0
            ? `Failing checks: ${failing.join(', ')}.`
            : warned.length > 0
              ? `No check fails; warnings on ${warned.join(', ')}.`
              : 'No check fails or warns.'}{' '}
          {verdict.sentence}
        </p>
        <details>
          <summary className="cursor-pointer text-[13px] text-accent-text">How is this decided?</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="m-0 text-[12.5px] text-ink-2">The rules are checked in this order; the first one that matches gives the verdict.</p>
            <ol className="m-0 flex list-none flex-col p-0">
              {verdict.rules.map((rule, index) => (
                <li key={rule.id} className={`flex gap-2 border-b border-line py-1 text-[12.5px] ${rule.matched ? 'text-ink' : 'text-ink-2'}`}>
                  <span className="w-5 shrink-0 text-right font-mono text-ink-3">{index + 1}</span>
                  <span className="min-w-0 flex-1">{rule.description}</span>
                  <span className={`shrink-0 font-mono text-[11px] ${VERDICT_CLASSES[rule.verdict].split(' ')[1]}`}>{VERDICT_LABELS[rule.verdict]}</span>
                  {rule.matched && <span className="shrink-0 font-mono text-[11px] text-accent-text">MATCHED</span>}
                </li>
              ))}
            </ol>
            <p className="label-caps m-0 pt-1 text-ink-3">Configuration used</p>
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] font-mono text-[11.5px]">
              {Object.entries(report.config).map(([key, value]) => (
                <div key={key} className="col-span-2 grid grid-cols-subgrid border-b border-line">
                  <dt className="py-0.5 text-ink-3">{key}</dt>
                  <dd className="m-0 py-0.5 text-right text-ink-2">{configValue(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </div>
    </div>
  )
}

export function AssumptionsList({ items }: { items: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((item) => (
        <li key={item} className="border-b border-line px-3 py-1.5 text-[12.5px] leading-relaxed text-ink-2 last:border-b-0">
          {item}
        </li>
      ))}
    </ul>
  )
}
