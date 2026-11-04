import type { ReactNode } from 'react'

export type Column<Row> = {
  key: string
  header: string
  align?: 'left' | 'right'
  className?: string
  render: (row: Row) => ReactNode
}

type TableProps<Row> = {
  caption: string
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  selectedKey?: string | null
  rowClassName?: (row: Row) => string
  captionVisible?: boolean
}

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  selectedKey = null,
  rowClassName,
  captionVisible = false,
}: TableProps<Row>) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <caption className={captionVisible ? 'label-caps px-3 py-2 text-left text-ink-3' : 'sr-only-text'}>
          {caption}
        </caption>
        <thead>
          <tr className="bg-panel-head">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`label-caps border-b border-line-strong px-3 py-1.5 font-medium whitespace-nowrap text-ink-3 ${column.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row)
            const selected = key === selectedKey
            return (
              <tr
                key={key}
                aria-current={selected ? 'true' : undefined}
                className={`border-b border-line transition-colors duration-150 hover:bg-hover ${selected ? 'bg-hover shadow-[inset_2px_0_0_var(--accent)]' : ''} ${rowClassName?.(row) ?? ''}`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-1.5 align-top ${column.align === 'right' ? 'text-right font-mono text-data tabular-nums' : ''} ${column.className ?? ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
