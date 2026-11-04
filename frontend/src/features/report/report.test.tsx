import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeResult } from '../../test/resultFixture'
import { money, profitFactor, VERDICT_CLASSES, VERDICT_LABELS } from './format'
import { HonestyReportPanel } from './HonestyReportPanel'
import { KpiStrip } from './KpiStrip'
import { RandomHistogram } from './RandomHistogram'
import { checkTag, failingChecks, histogramGeometry, kpisOf, sweepGrid, tint } from './reportModel'
import { SweepHeatmap } from './SweepHeatmap'

describe('verdict and tags', () => {
  it('maps every verdict to its label and colour', () => {
    expect(VERDICT_LABELS).toEqual({ CREDIBLE: 'CREDIBLE', FRAGILE: 'FRAGILE', NOT_CREDIBLE: 'NOT CREDIBLE' })
    expect(VERDICT_CLASSES.CREDIBLE).toContain('profit')
    expect(VERDICT_CLASSES.FRAGILE).toContain('warn')
    expect(VERDICT_CLASSES.NOT_CREDIBLE).toContain('loss')
  })

  it('never shows an insufficient check as a plain pass', () => {
    const report = makeResult().report
    const tags = report.checks.map(checkTag)
    expect(tags[1]).toEqual({ state: 'FAIL', label: 'FAIL', note: 'insufficient data' })
    expect(tags[3]).toEqual({ state: 'WARN', label: 'WARN', note: 'insufficient data' })
    expect(tags[0]).toEqual({ state: 'PASS', label: 'PASS', note: null })
    expect(failingChecks(report)).toEqual(['Enough trades', 'Versus random entries'])
  })

  it('renders the six checks, the verdict paragraph naming the failing checks, and the rules', () => {
    render(<HonestyReportPanel report={makeResult().report} />)
    expect(screen.getAllByRole('row')).toHaveLength(7)
    expect(screen.getAllByText('insufficient data')).toHaveLength(2)
    expect(screen.getByTestId('verdict-explanation')).toHaveTextContent('Failing checks: Enough trades, Versus random entries.')
    expect(screen.getByText('How is this decided?')).toBeInTheDocument()
    expect(screen.getByText('The trade-count check fails.')).toBeInTheDocument()
    expect(screen.getByText('MATCHED')).toBeInTheDocument()
    expect(screen.getByText('random_pass_percentile')).toBeInTheDocument()
  })
})

describe('profit factor and money', () => {
  it('shows n/a when there is no losing trade, never zero or infinity', () => {
    expect(profitFactor(null)).toBe('n/a')
    expect(profitFactor(Infinity)).toBe('n/a')
    expect(profitFactor(0)).toBe('0.00')
    expect(profitFactor(1.234)).toBe('1.23')
  })

  it('signs money with a real minus', () => {
    expect(money(1234.5)).toBe('+1,234.50')
    expect(money(-3)).toBe('−3.00')
    expect(money(null)).toBe('—')
  })

  it('puts n/a in the KPI strip for a run without losses and states why', () => {
    const payload = makeResult({ pnls: [10, 20, 5], profitFactor: null })
    const kpis = kpisOf(payload)
    expect(kpis.find((kpi) => kpi.label === 'Profit factor')).toMatchObject({ value: 'n/a', note: 'no losing trade' })
    render(<KpiStrip payload={payload} />)
    expect(screen.getByTestId('kpi-Profit factor')).toHaveTextContent('n/a')
    expect(screen.getByTestId('kpi-PF without best trade')).toHaveTextContent('n/a')
    expect(screen.getByTestId('verdict')).toHaveTextContent('NOT CREDIBLE')
  })
})

describe('versus random histogram', () => {
  it('marks the real value and states the percentile with its meaning', () => {
    const random = makeResult().report.random_entries
    const geometry = histogramGeometry(random)
    expect(geometry?.bars).toHaveLength(6)
    expect(geometry?.bars.filter((bar) => bar.real)).toHaveLength(1)
    render(<RandomHistogram random={random} passPercentile={95} />)
    expect(screen.getByTestId('random-percentile')).toHaveTextContent('62.5th')
    expect(screen.getByText(/does not say the strategy will make money/)).toBeInTheDocument()
  })

  it('explains when no comparison was possible', () => {
    const random = { ...makeResult().report.random_entries, histogram: null, percentile: null }
    render(<RandomHistogram random={random} passPercentile={95} />)
    expect(screen.getByText(/No comparison was possible/)).toBeInTheDocument()
  })
})

describe('parameter sweep', () => {
  it('lays cells on the two swept axes and marks the chosen and best points', () => {
    const report = makeResult().report
    const grid = sweepGrid(report.sweep ?? (null as never))
    expect(grid.rows).toHaveLength(3)
    expect(grid.rows[0]).toHaveLength(2)
    render(<SweepHeatmap report={report} />)
    const table = screen.getByRole('table')
    expect(within(table).getByText('CHOSEN')).toBeInTheDocument()
    expect(within(table).getByText('BEST')).toBeInTheDocument()
    expect(within(table).getByText('invalid')).toBeInTheDocument()
    expect(screen.getByText(/Overfitting check/)).toBeInTheDocument()
  })

  it('uses dark tints on a diverging profit and loss scale', () => {
    expect(tint(100, 100)).toBe('color-mix(in srgb, var(--profit) 45%, var(--bg-panel))')
    expect(tint(-10, 100)).toBe('color-mix(in srgb, var(--loss) 15%, var(--bg-panel))')
    expect(tint(null, 100)).toBeUndefined()
  })

  it('says why when the sweep did not run', () => {
    const payload = makeResult()
    const report = { ...payload.report, sweep: null, robustness: { ...payload.report.robustness, parameters: { status: 'not_run' as const, insufficient_data: false, reason: 'The sweep was switched off for this run.' } } }
    render(<SweepHeatmap report={report} />)
    expect(screen.getByTestId('sweep-not-run')).toHaveTextContent('The sweep was switched off for this run.')
  })
})
