import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Checkbox, DateRangeInput, NumberInput, Select, TextInput } from './Field'
import { FileDropZone } from './FileDropZone'
import { checkFile, formatBytes } from './format'
import { Modal } from './Modal'
import { Panel } from './Panel'
import { PropertyGrid, PropertyRow } from './PropertyGrid'
import { EmptyState, ErrorPanel, LoadingLine } from './States'
import { StatusBar } from './StatusBar'
import { Table } from './Table'
import { Tabs } from './Tabs'
import { ModeBadge, Tag, type TagState } from './Tag'

describe('Panel and PropertyGrid', () => {
  it('labels the region by its header and pairs labels with controls', () => {
    render(
      <Panel label="Costs · risk">
        <PropertyGrid label="Costs">
          <PropertyRow label="Fee" htmlFor="fee">
            <input id="fee" defaultValue="0.05" />
          </PropertyRow>
          <PropertyRow label="Mode">SAMPLE</PropertyRow>
        </PropertyGrid>
      </Panel>,
    )
    expect(screen.getByRole('region', { name: 'Costs · risk' })).toBeInTheDocument()
    expect(screen.getByLabelText('Fee')).toHaveValue('0.05')
    expect(screen.getByText('Mode').tagName).toBe('SPAN')
  })
})

describe('Tag', () => {
  it.each<TagState>(['PASS', 'WARN', 'FAIL', 'DONE', 'RUN', 'WAIT', 'SOON'])('renders %s as text', (state) => {
    render(<Tag state={state} />)
    expect(screen.getByText(state)).toBeInTheDocument()
  })

  it('labels sample data in warn colour', () => {
    render(<ModeBadge mode="SAMPLE DATA" />)
    expect(screen.getByText('SAMPLE DATA').className).toContain('text-warn-text')
  })
})

describe('Button', () => {
  it('is a real button with a 34px minimum and toggles expose pressed state', async () => {
    const onClick = vi.fn()
    render(
      <>
        <Button variant="primary" onClick={onClick}>
          Run backtest
        </Button>
        <Button variant="toggle" active>
          Sweep
        </Button>
        <Button disabled>Later</Button>
      </>,
    )
    const primary = screen.getByRole('button', { name: 'Run backtest' })
    expect(primary.className).toContain('min-h-[34px]')
    await userEvent.click(primary)
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Sweep' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled()
  })
})

describe('Table', () => {
  it('renders a captioned table with right-aligned numbers and marks the selected row', () => {
    render(
      <Table
        caption="Strategies"
        rows={[
          { id: 'a', name: 'Alpha', n: 1 },
          { id: 'b', name: 'Beta', n: 2 },
        ]}
        rowKey={(row) => row.id}
        selectedKey="b"
        columns={[
          { key: 'name', header: 'Name', render: (row) => row.name },
          { key: 'n', header: 'N', align: 'right', render: (row) => row.n },
        ]}
      />,
    )
    expect(screen.getByRole('table', { name: 'Strategies' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Name', 'N'])
    expect(screen.getByText('Beta').closest('tr')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('2').className).toContain('text-right')
  })
})

function TabsHarness() {
  const [value, setValue] = useState('library')
  return (
    <Tabs
      label="Strategy source"
      idPrefix="t"
      value={value}
      onChange={setValue}
      items={[
        { id: 'library', label: 'Library' },
        { id: 'custom', label: 'Custom' },
        { id: 'words', label: 'Describe in words', soon: true },
      ]}
    />
  )
}

describe('Tabs', () => {
  it('moves with arrow keys, skips the disabled SOON tab and keeps it a real disabled button', async () => {
    render(<TabsHarness />)
    const library = screen.getByRole('tab', { name: 'Library' })
    expect(library).toHaveAttribute('aria-selected', 'true')
    library.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Custom' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Custom' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveFocus()
    const soon = screen.getByRole('tab', { name: /Describe in words/ })
    expect(soon).toBeDisabled()
    expect(soon).toHaveTextContent('SOON')
  })
})

describe('Form controls', () => {
  it('wires hints, units and errors to the input', async () => {
    const onValueChange = vi.fn()
    render(
      <>
        <label htmlFor="stop">Stop</label>
        <NumberInput id="stop" value="2" onValueChange={onValueChange} unit="x ATR" min={0.5} max={10} step={0.5} error="Too high" />
      </>,
    )
    const input = screen.getByLabelText('Stop')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain('stop-hint')
    expect(screen.getByText('0.5 to 10 · step 0.5')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Too high')
    await userEvent.type(input, '5')
    expect(onValueChange).toHaveBeenCalledWith('25')
  })

  it('renders select, text, checkbox and date range with accessible names', async () => {
    const onChange = vi.fn()
    render(
      <>
        <label htmlFor="tf">Timeframe</label>
        <Select id="tf" options={[{ value: '5m', label: '5m' }, { value: '1h', label: '1h' }]} defaultValue="5m" />
        <label htmlFor="sym">Symbol</label>
        <TextInput id="sym" defaultValue="BTC-USD" />
        <Checkbox id="ok" label="I understand" />
        <DateRangeInput id="range" start="2024-01-02" end="2024-02-01" onChange={onChange} />
      </>,
    )
    expect(screen.getByLabelText('Timeframe')).toHaveValue('5m')
    expect(screen.getByLabelText('Symbol')).toHaveValue('BTC-USD')
    await userEvent.click(screen.getByLabelText('I understand'))
    expect(screen.getByLabelText('I understand')).toBeChecked()
    expect(screen.getByLabelText('Start date')).toHaveValue('2024-01-02')
    expect(screen.getByLabelText('End date')).toHaveValue('2024-02-01')
  })
})

describe('FileDropZone', () => {
  it('rejects oversized files before upload and accepts others by picker', async () => {
    const onFile = vi.fn()
    const onReject = vi.fn()
    render(<FileDropZone id="csv" label="Choose file" accept=".csv" maxBytes={10} onFile={onFile} onReject={onReject} />)
    const input = document.getElementById('csv') as HTMLInputElement
    await userEvent.upload(input, new File(['0123456789ABC'], 'big.csv', { type: 'text/csv' }))
    expect(onReject).toHaveBeenCalledWith(expect.stringContaining('the limit is 10 B'))
    await userEvent.upload(input, new File(['abc'], 'ok.csv', { type: 'text/csv' }))
    expect(onFile).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument()
  })

  it('formats sizes and flags empty files', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
    expect(checkFile(new File([], 'e.csv'), 10)).toBe('e.csv is empty.')
  })
})

describe('Modal', () => {
  it('traps focus, closes on Escape only when allowed', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal title="Before you start" footer={<button type="button">Continue</button>}>
        <a href="#x">Link</a>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Before you start' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('link', { name: 'Link' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Link' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    rerender(
      <Modal title="Before you start" onClose={onClose}>
        <a href="#x">Link</a>
      </Modal>,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('States and StatusBar', () => {
  it('renders the three state patterns', () => {
    render(
      <>
        <EmptyState title="No runs yet" action={<button type="button">New run</button>}>
          History lives only in this browser.
        </EmptyState>
        <LoadingLine label="Loading strategies" />
        <ErrorPanel
          error={{
            code: 'capacity_busy',
            title: 'The engine is busy',
            message: 'busy',
            action: 'Try again in 15 s.',
            stage: null,
            requestId: 'abc123',
            retryAfter: 15,
          }}
        />
        <StatusBar end="Research tool · not financial advice">ENGINE OK</StatusBar>
      </>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading strategies')
    expect(screen.getByRole('alert')).toHaveTextContent('request id abc123')
    expect(screen.getByRole('contentinfo')).toHaveTextContent('not financial advice')
  })
})
