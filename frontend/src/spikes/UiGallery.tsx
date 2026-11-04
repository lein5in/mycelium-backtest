import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api/client'
import { describeError, describeRunFailure } from '../api/errorMessages'
import csvProblems from '../api/fixtures/csv_preview_problems.json'
import { isCsvPreview } from '../api/guards'
import { CsvReportView } from '../features/csv/CsvReportView'
import { Button } from '../ui/Button'
import { Checkbox, DateRangeInput, NumberInput, Select, TextInput } from '../ui/Field'
import { FileDropZone } from '../ui/FileDropZone'
import { Hint } from '../ui/Hint'
import { Modal } from '../ui/Modal'
import { Panel } from '../ui/Panel'
import { PropertyGrid, PropertyRow } from '../ui/PropertyGrid'
import { EmptyState, ErrorPanel, LoadingLine, SkeletonRows } from '../ui/States'
import { StatusBar } from '../ui/StatusBar'
import { Table } from '../ui/Table'
import { Tabs } from '../ui/Tabs'
import { ModeBadge, Tag, type TagState } from '../ui/Tag'

const TAGS: TagState[] = ['PASS', 'WARN', 'FAIL', 'DONE', 'RUN', 'WAIT', 'SOON']

const ERRORS = [
  describeError(new ApiError({ code: 'engine_unreachable', status: 0, message: 'The engine could not be reached.' })),
  describeError(new ApiError({ code: 'rate_limited', status: 429, message: 'The limit is 12 runs per hour.', retryAfter: 1260, requestId: 'a1b2c3d4e5f60718' })),
  describeError(new ApiError({ code: 'capacity_busy', status: 503, message: 'The server is busy with other runs.', retryAfter: 15, requestId: '0f9e8d7c6b5a4932' })),
  describeError(new ApiError({ code: 'file_too_large', status: 413, message: 'The file is larger than the 10 MB limit.', requestId: '5c4b3a2918273645' })),
  describeError(new ApiError({ code: 'provider_unavailable', status: 503, message: 'Coinbase did not answer.', stage: 'DATA', requestId: '7a6b5c4d3e2f1a0b' })),
  describeRunFailure('csv_invalid', 'The file has 3 problems.', 'DATA'),
  describeRunFailure('run_timeout', 'The run went over the 120-second limit and was stopped.', 'AUDITOR'),
  describeRunFailure('run_cancelled', 'The run was cancelled.', 'SIMULATOR'),
]

const ROWS = [
  { id: 'orb', name: 'Opening Range Breakout', markets: 'Stocks & ETFs, Crypto', bars: 4758 },
  { id: 'gap', name: 'Gap Fade', markets: 'Stocks & ETFs', bars: 19500 },
]

export function UiGallery() {
  const [tab, setTab] = useState('a')
  const [number, setNumber] = useState('14')
  const [range, setRange] = useState({ start: '2024-01-02', end: '2024-04-01' })
  const [modal, setModal] = useState(false)
  const [toggle, setToggle] = useState(true)
  const preview = isCsvPreview(csvProblems) ? csvProblems : null

  return (
    <main className="flex min-h-full flex-col bg-app">
      <header className="flex min-h-11 flex-wrap items-center gap-3 border-b border-line bg-panel-head px-3">
        <h1 className="label-caps m-0 font-medium text-ink-2">
          UI primitives <span className="text-ink-3">· development only</span>
        </h1>
        <nav aria-label="Development spikes" className="ml-auto flex gap-3 font-mono text-[11px]">
          <Link className="text-accent-text underline" to="/app/spike/run">run</Link>
          <Link className="text-accent-text underline" to="/app/spike/heatmap">heatmap</Link>
          <Link className="text-accent-text underline" to="/app/spike/crawler">crawler</Link>
        </nav>
      </header>
      <div className="grid gap-px bg-line p-px lg:grid-cols-2 2xl:grid-cols-3">
        <Panel label="Tags · badges · buttons">
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap gap-2">{TAGS.map((state) => <Tag key={state} state={state} />)}</div>
            <div className="flex flex-wrap gap-2">
              <ModeBadge mode="SAMPLE DATA" />
              <ModeBadge mode="ESTIMATED FROM CANDLES" />
              <ModeBadge mode="PUBLIC EXCHANGE DATA" />
              <ModeBadge mode="USER CSV" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary">Run backtest</Button>
              <Button>Secondary</Button>
              <Button variant="toggle" active={toggle} onClick={() => setToggle((value) => !value)}>Toggle</Button>
              <Button disabled>Disabled</Button>
              <Button onClick={() => setModal(true)}>Open modal</Button>
            </div>
          </div>
        </Panel>
        <Panel label="Tabs">
          <Tabs
            label="Gallery tabs"
            idPrefix="gallery"
            value={tab}
            onChange={setTab}
            items={[{ id: 'a', label: 'Library' }, { id: 'b', label: 'Second' }, { id: 'c', label: 'Describe in words', soon: true }]}
          />
          <p className="m-0 px-3 py-3 text-[13px] text-ink-2">Selected tab: {tab}. Arrow keys move between enabled tabs.</p>
        </Panel>
        <Panel label="Property grid · form controls">
          <PropertyGrid label="Controls">
            <PropertyRow label="Select" htmlFor="g-select">
              <Select id="g-select" defaultValue="5m" options={[{ value: '5m', label: '5m' }, { value: '1h', label: '1h' }]} />
            </PropertyRow>
            <PropertyRow label="Number with unit" htmlFor="g-number">
              <NumberInput id="g-number" value={number} onValueChange={setNumber} unit="bars" min={2} max={100} step={1} />
            </PropertyRow>
            <PropertyRow label="Number with error" htmlFor="g-number-error">
              <NumberInput id="g-number-error" value="250" onValueChange={() => {}} unit="%" min={0} max={100} error="At most 100." />
            </PropertyRow>
            <PropertyRow label="Text" htmlFor="g-text">
              <TextInput id="g-text" defaultValue="SAMPLE-A" />
            </PropertyRow>
            <PropertyRow label="Date range" htmlFor="g-range-start">
              <DateRangeInput id="g-range" start={range.start} end={range.end} onChange={setRange} hint="Up to 730 days for 5m" />
            </PropertyRow>
            <PropertyRow label="Checkbox" htmlFor="g-check">
              <Checkbox id="g-check" label="On" defaultChecked />
            </PropertyRow>
            <PropertyRow label="Read-only value">12,345.67</PropertyRow>
          </PropertyGrid>
          <div className="border-t border-line p-3">
            <FileDropZone id="g-file" label="Choose a CSV file" accept=".csv" maxBytes={10 * 1024 * 1024} onFile={() => {}} onReject={() => {}} />
            <div className="mt-2"><Hint tone="warn">Inline hint in warn tone.</Hint></div>
          </div>
        </Panel>
        <Panel label="Table">
          <Table
            caption="Example table"
            rows={ROWS}
            rowKey={(row) => row.id}
            selectedKey="orb"
            columns={[
              { key: 'name', header: 'Strategy', render: (row) => row.name },
              { key: 'markets', header: 'Markets', render: (row) => <span className="font-mono text-[11.5px] text-ink-2">{row.markets}</span> },
              { key: 'bars', header: 'Bars', align: 'right', render: (row) => row.bars.toLocaleString('en-US') },
            ]}
          />
        </Panel>
        <Panel label="Empty · loading">
          <EmptyState title="No runs saved in this browser yet" action={<Button variant="primary">Configure a run</Button>}>
            History lives only in this browser.
          </EmptyState>
          <LoadingLine label="Loading strategies" />
          <SkeletonRows rows={3} label="Loading" />
        </Panel>
        <Panel label="Error states" bodyClassName="flex flex-col gap-px bg-line">
          {ERRORS.map((error) => <ErrorPanel key={error.code} error={error} compact />)}
        </Panel>
        {preview && (
          <Panel label="CSV report with problems">
            <CsvReportView preview={preview} />
          </Panel>
        )}
      </div>
      <StatusBar end="Research tool · not financial advice">
        <span>ENGINE ONLINE</span>
        <span>stage 3/6</span>
      </StatusBar>
      {modal && (
        <Modal title="Modal" onClose={() => setModal(false)} footer={<Button variant="primary" onClick={() => setModal(false)}>Close</Button>}>
          <p className="m-0 text-[14px] text-ink">Focus stays inside; Escape closes this one.</p>
        </Modal>
      )}
    </main>
  )
}
