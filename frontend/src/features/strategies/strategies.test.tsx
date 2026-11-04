import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import csvProblems from '../../api/fixtures/csv_preview_problems.json'
import csvOk from '../../api/fixtures/csv_preview_ok.json'
import strategiesFixture from '../../api/fixtures/strategies.json'
import type { CsvPreview, Strategies } from '../../api/types'
import { CsvReportView } from '../csv/CsvReportView'
import { StrategyCard } from './StrategyCard'
import { StrategyLibrary } from './StrategyLibrary'

const strategies = (strategiesFixture as Strategies).strategies

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing fixture value')
  return value
}

describe('StrategyLibrary', () => {
  it('disables incompatible strategies with the reason and marks Custom as SOON', async () => {
    const onSelect = vi.fn()
    render(<StrategyLibrary strategies={strategies} market="crypto_24x7" selectedId="orb" onSelect={onSelect} />)
    const gap = screen.getByRole('button', { name: 'Gap Fade' })
    expect(gap).toBeDisabled()
    expect(gap).toHaveAccessibleDescription(/supports Stocks & ETFs only/)
    const custom = screen.getByRole('button', { name: /Custom strategy/ })
    expect(custom).toBeDisabled()
    expect(custom).toHaveTextContent('SOON')
    expect(screen.getByRole('button', { name: 'Opening Range Breakout' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Donchian Channel Breakout' }))
    expect(onSelect).toHaveBeenCalledWith('donchian_breakout')
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Strategy', 'Markets', 'Timeframes'])
  })
})

describe('StrategyCard', () => {
  it('shows the idea, both conditions, the schematic, parameters with ranges and the standing note, and no figures', () => {
    const orb = must(strategies.find((item) => item.id === 'orb'))
    const values = Object.fromEntries(orb.parameters.map((p) => [p.name, String(p.default)]))
    const { container } = render(<StrategyCard strategy={orb} market="us_equity" values={values} errors={{}} onChange={() => {}} />)
    expect(screen.getByRole('heading', { name: orb.name })).toBeInTheDocument()
    expect(screen.getByText(orb.works_when)).toBeInTheDocument()
    expect(screen.getByText(orb.fails_when)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Opening range breakout/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Opening range')).toHaveValue(30)
    expect(screen.getByText('5 to 240 · step 5')).toBeInTheDocument()
    expect(screen.getByText(orb.note)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/win rate|profit factor|\d+(\.\d+)?\s?% (return|profit)/i)
  })
})

describe('CsvReportView', () => {
  it('lists every problem with row and column and blocks the run', () => {
    const preview = csvProblems as CsvPreview
    render(<CsvReportView preview={preview} />)
    expect(screen.getByText('BLOCKED')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(`${preview.report.problem_count} problems block the run`)
    const table = screen.getByRole('table', { name: 'Problems found in the file' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(preview.report.problems.length)
    const first = must(preview.report.problems[0])
    expect(within(must(rows[0])).getByText(String(first.line))).toBeInTheDocument()
    expect(within(must(rows[0])).getByText(must(first.column))).toBeInTheDocument()
  })

  it('shows the count of unlisted problems and the warnings', () => {
    const base = csvProblems as CsvPreview
    const preview: CsvPreview = { ...base, report: { ...base.report, problem_count: 120, warnings: ['12 bars are missing.'] } }
    render(<CsvReportView preview={preview} />)
    expect(screen.getByText(`and ${120 - base.report.problems.length} more not listed`)).toBeInTheDocument()
    expect(screen.getByText('12 bars are missing.')).toBeInTheDocument()
  })

  it('shows a ready file with its timeframe and bar count', () => {
    const preview = csvOk as CsvPreview
    render(<CsvReportView preview={preview} />)
    expect(screen.getByText('READY')).toBeInTheDocument()
    expect(screen.getByText(must(preview.report.timeframe))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
