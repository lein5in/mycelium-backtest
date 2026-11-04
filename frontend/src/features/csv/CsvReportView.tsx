import type { CsvPreview } from '../../api/types'
import { PropertyGrid, PropertyRow } from '../../ui/PropertyGrid'
import { Table } from '../../ui/Table'
import { Tag } from '../../ui/Tag'
import { formatCount } from '../config/configModel'
import { hiddenProblems, period } from './csvModel'

export function CsvReportView({ preview }: { preview: CsvPreview }) {
  const { report } = preview
  const more = hiddenProblems(report)
  return (
    <div className="flex flex-col">
      <PropertyGrid label="Import summary">
        <PropertyRow label="Status">
          <Tag state={preview.ok ? 'PASS' : 'FAIL'} label={preview.ok ? 'READY' : 'BLOCKED'} />
        </PropertyRow>
        <PropertyRow label="Rows">{formatCount(report.rows)}</PropertyRow>
        <PropertyRow label="Bars">{preview.bar_count === null ? '—' : formatCount(preview.bar_count)}</PropertyRow>
        <PropertyRow label="Timeframe">{report.timeframe ?? 'not detected'}</PropertyRow>
        <PropertyRow label="Period">{period(preview) ?? '—'}</PropertyRow>
        <PropertyRow label="Timestamps">
          {report.timestamp_format ?? '—'}
          {report.timezone ? ` · ${report.timezone}` : ''}
        </PropertyRow>
      </PropertyGrid>
      {report.problem_count > 0 && (
        <div className="border-t border-line">
          <p role="alert" className="m-0 px-3 py-2 text-[13px] text-loss-text">
            {formatCount(report.problem_count)} problem{report.problem_count === 1 ? '' : 's'} block the run. Fix them in
            the file, then upload it again.
          </p>
          <Table
            caption="Problems found in the file"
            rows={report.problems.map((problem, index) => ({ ...problem, index }))}
            rowKey={(row) => String(row.index)}
            columns={[
              { key: 'line', header: 'Row', align: 'right', render: (row) => row.line ?? '—' },
              { key: 'column', header: 'Column', render: (row) => <span className="font-mono text-[12px]">{row.column ?? '—'}</span> },
              { key: 'message', header: 'Problem', render: (row) => <span className="text-[12.5px]">{row.message}</span> },
            ]}
          />
          {more > 0 && (
            <p className="m-0 border-t border-line px-3 py-2 font-mono text-[11.5px] text-ink-3">
              and {formatCount(more)} more not listed
            </p>
          )}
        </div>
      )}
      {report.warnings.length > 0 && (
        <div className="border-t border-line px-3 py-2">
          <h4 className="label-caps m-0 mb-1 font-medium text-warn-text">Warnings</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-ink-2">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="border-t border-line px-3 py-2 text-[12.5px] text-ink-2">
        <summary className="cursor-pointer text-ink-3">How the file is read</summary>
        <ul className="mt-2 mb-0 flex flex-col gap-1 pl-4">
          {report.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}
