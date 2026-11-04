import { useEffect, useMemo, useState } from 'react'
import { previewCsv } from '../../api/client'
import { describeError, type DescribedError } from '../../api/errorMessages'
import { csvReportOf } from '../../api/guards'
import type { CsvPreview, Limits, MarketKind } from '../../api/types'
import { Select } from '../../ui/Field'
import { FileDropZone } from '../../ui/FileDropZone'
import { Hint } from '../../ui/Hint'
import { PropertyGrid, PropertyRow } from '../../ui/PropertyGrid'
import { ErrorPanel, LoadingLine } from '../../ui/States'
import { MARKET_LABELS } from '../config/configModel'
import { CsvReportView } from './CsvReportView'
import { CSV_ROLES, mappingOverrides, needsTimezone, timezones, type CsvRole } from './csvModel'

export type CsvSelection = {
  file: File | null
  timezone: string
  columns: Record<string, string> | null
  preview: CsvPreview | null
}

type CsvImportProps = {
  limits: Limits
  market: MarketKind
  onMarketChange: (market: MarketKind) => void
  onChange: (selection: CsvSelection) => void
  preview?: typeof previewCsv
}

type Outcome = { key: string; preview: CsvPreview | null; error: DescribedError | null }

type Upload = { file: File; serial: number }

export function CsvImport({ limits, market, onMarketChange, onChange, preview = previewCsv }: CsvImportProps) {
  const [upload, setUpload] = useState<Upload | null>(null)
  const [timezone, setTimezone] = useState('')
  const [mapping, setMapping] = useState<Partial<Record<CsvRole, string>>>({})
  const [detected, setDetected] = useState<{ serial: number; mapping: Record<string, string> } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [rejected, setRejected] = useState<string | null>(null)
  const zones = useMemo(() => timezones(), [])

  const baseline = detected && upload && detected.serial === upload.serial ? detected.mapping : {}
  const columns = mappingOverrides(baseline, mapping)
  const key = upload ? JSON.stringify([upload.serial, timezone, columns, market]) : ''
  const current = outcome && outcome.key === key ? outcome : null
  const checking = Boolean(upload) && !current
  const result = current?.preview ?? null

  useEffect(() => {
    if (!upload) return
    const controller = new AbortController()
    const [, zone, chosen] = JSON.parse(key) as [number, string, Record<string, string> | null, string]
    preview({ file: upload.file, timezone: zone || null, columns: chosen }, { market }, { signal: controller.signal })
      .then((next) => {
        setDetected((value) => (value && value.serial === upload.serial ? value : { serial: upload.serial, mapping: next.report.mapping }))
        setOutcome({ key, preview: next, error: null })
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        const described = describeError(caught)
        const report = caught && typeof caught === 'object' && 'details' in caught ? csvReportOf(caught.details) : null
        setOutcome({
          key,
          preview: null,
          error: report ? { ...described, message: report.problems[0]?.message ?? described.message } : described,
        })
      })
    return () => controller.abort()
  }, [upload, key, market, preview])

  useEffect(() => {
    const chosen = key ? (JSON.parse(key) as [number, string, Record<string, string> | null])[2] : null
    onChange({ file: upload?.file ?? null, timezone, columns: chosen, preview: result })
  }, [upload, timezone, key, result, onChange])

  const report = result?.report ?? null
  const headers = report?.columns ?? []
  const timezoneMissing = needsTimezone(report)

  return (
    <div className="flex flex-col">
      <PropertyGrid label="CSV settings">
        <PropertyRow label="Market" htmlFor="csv-market">
          <Select
            id="csv-market"
            value={market}
            onChange={(event) => onMarketChange(event.target.value as MarketKind)}
            options={(Object.keys(MARKET_LABELS) as MarketKind[]).map((value) => ({ value, label: MARKET_LABELS[value] }))}
          />
        </PropertyRow>
        <PropertyRow label="Time zone" htmlFor="csv-timezone">
          <Select
            id="csv-timezone"
            value={timezone}
            error={timezoneMissing ? 'Required: the timestamps carry no offset.' : null}
            hint="Used only for timestamps without an offset."
            onChange={(event) => setTimezone(event.target.value)}
            options={[{ value: '', label: 'From the file' }, ...zones.map((zone) => ({ value: zone, label: zone }))]}
          />
        </PropertyRow>
      </PropertyGrid>
      <div className="border-t border-line px-3 py-3">
        <FileDropZone
          id="csv-file"
          label="Choose a CSV file"
          accept=".csv,text/csv"
          maxBytes={limits.csv_max_bytes}
          fileName={upload?.file.name ?? null}
          onReject={setRejected}
          onFile={(file) => {
            setRejected(null)
            setMapping({})
            setUpload((value) => ({ file, serial: (value?.serial ?? 0) + 1 }))
          }}
        />
        {rejected && (
          <div className="mt-2">
            <Hint tone="error">{rejected}</Hint>
          </div>
        )}
        <p className="mt-2 mb-0 text-[12px] leading-snug text-ink-3">
          Your file stays in this browser and is sent to the engine only to preview and to run. Imports are processed to
          produce your result and are not kept.
        </p>
      </div>
      {checking && <LoadingLine label="Checking the file" />}
      {current?.error && (
        <div className="border-t border-line">
          <ErrorPanel error={current.error} compact />
        </div>
      )}
      {report && headers.length > 0 && (
        <div className="border-t border-line">
          <h4 className="label-caps m-0 border-b border-line bg-panel-head px-3 py-1.5 font-medium text-ink-3">Column mapping</h4>
          <PropertyGrid label="Column mapping">
            {CSV_ROLES.map((role) => (
              <PropertyRow key={role} label={role} htmlFor={`csv-map-${role}`}>
                <Select
                  id={`csv-map-${role}`}
                  value={mapping[role] ?? report.mapping[role] ?? ''}
                  onChange={(event) => setMapping((value) => ({ ...value, [role]: event.target.value }))}
                  options={[
                    { value: '', label: 'Not mapped', disabled: true },
                    ...headers.map((header) => ({ value: header, label: header })),
                  ]}
                />
              </PropertyRow>
            ))}
          </PropertyGrid>
        </div>
      )}
      {result && (
        <div className="border-t border-line">
          <CsvReportView preview={result} />
        </div>
      )}
    </div>
  )
}
