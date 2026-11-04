import type { HonestyReport } from '../../api/result'
import { money } from './format'
import { sweepGrid, tint } from './reportModel'

const same = (a: number[] | null, b: number[]) => a !== null && a.length === b.length && a.every((value, index) => value === b[index])

function axisValue(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export function SweepHeatmap({ report }: { report: HonestyReport }) {
  const sweep = report.sweep
  if (!sweep) {
    return (
      <p className="m-0 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2" data-testid="sweep-not-run">
        The parameter sweep did not run. {report.robustness.parameters.reason}
      </p>
    )
  }
  const { rows, rowAxis, columnAxis } = sweepGrid(sweep)
  const maxAbs = Math.max(0, ...sweep.cells.map((cell) => Math.abs(cell.net_pnl ?? 0)))
  const fraction = sweep.profitable_neighbour_fraction
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="max-w-full overflow-x-auto">
        <table className="border-collapse font-mono text-[11.5px]">
          <caption className="sr-only-text">
            Net P&L for each setting of {rowAxis.label}
            {columnAxis ? ` and ${columnAxis.label}` : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-1.5 py-1 text-left font-normal text-ink-3">
                {rowAxis.label} {columnAxis ? `↓ · ${columnAxis.label} →` : ''}
              </th>
              {(columnAxis?.values ?? [null]).map((value, index) => (
                <th key={index} scope="col" className="px-1.5 py-1 text-right font-normal text-ink-3">
                  {value === null ? 'net P&L' : axisValue(value)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row" className="px-1.5 py-1 text-left font-normal text-ink-3">
                  {axisValue(rowAxis.values[rowIndex] ?? 0)}
                </th>
                {row.map((cell, columnIndex) => {
                  const chosen = same(sweep.chosen, [rowIndex, columnIndex].slice(0, sweep.axes.length))
                  const best = same(sweep.best, [rowIndex, columnIndex].slice(0, sweep.axes.length))
                  const value = cell?.state === 'ok' ? cell.net_pnl : null
                  const background = tint(value, maxAbs)
                  return (
                    <td
                      key={columnIndex}
                      title={cell?.message ?? undefined}
                      data-chosen={chosen || undefined}
                      data-best={best || undefined}
                      className={`relative h-9 min-w-[74px] border border-line px-1.5 text-right tabular-nums ${chosen ? 'outline-2 -outline-offset-2 outline-accent' : ''} ${value === null ? 'text-ink-3' : value > 0 ? 'text-profit-text' : value < 0 ? 'text-loss-text' : 'text-ink'}`}
                      style={background ? { background } : undefined}
                    >
                      {cell === null || cell.state === 'not_run' ? '—' : cell.state === 'invalid' ? 'invalid' : money(value, 0)}
                      {(chosen || best) && (
                        <span className="absolute top-0.5 left-1 text-[9px] tracking-[0.06em] text-ink-2">
                          {chosen ? 'CHOSEN' : ''}
                          {chosen && best ? ' · ' : ''}
                          {best ? 'BEST' : ''}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 font-mono text-[11.5px] text-ink-3">
        {sweep.completed} of {sweep.combinations} settings run{sweep.stopped_by_budget ? ' (stopped by the time budget, nearest settings first)' : ''} ·
        profitable neighbours {fraction === null ? '—' : `${Math.round(fraction * 100)}%`}
        {sweep.chosen_is_spike ? ' · chosen setting is an isolated spike' : ''}
      </p>
      <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">
        Overfitting check: a setting that wins while its neighbours lose was probably fitted to this data. Prefer settings whose
        neighbours are also profitable, and never pick the best cell of a sweep as proof of an edge.
      </p>
    </div>
  )
}
