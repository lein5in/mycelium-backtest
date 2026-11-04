import { useCallback, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { ApiError, postCsvRun, postRun } from '../api/client'
import type { RunRequestDocument } from '../api/result'
import { describeError, type DescribedError } from '../api/errorMessages'
import { fieldProblems } from '../api/guards'
import type { MarketKind } from '../api/types'
import { useConsent } from '../app/context'
import { useCatalog, type Catalog } from '../app/useCatalog'
import {
  compatibility,
  csvRunOptions,
  estimatedBars,
  formatCount,
  initialState,
  marketOf,
  MARKET_LABELS,
  providersFor,
  rangeError,
  runBody,
  serverFieldErrors,
  SOURCE_LABELS,
  stateFromRequest,
  switchSource,
  validate,
  withProvider,
  withStrategy,
  type ConfigState,
  type FieldErrors,
  type SourceKind,
  type StoredRequest,
} from '../features/config/configModel'
import { entryFromRequest, history } from '../features/history/historyStore'
import { CsvImport, type CsvSelection } from '../features/csv/CsvImport'
import { blocksRun } from '../features/csv/csvModel'
import { StrategyCard } from '../features/strategies/StrategyCard'
import { StrategyLibrary } from '../features/strategies/StrategyLibrary'
import { Button } from '../ui/Button'
import { Checkbox, DateRangeInput, NumberInput, Select } from '../ui/Field'
import { Hint } from '../ui/Hint'
import { Panel } from '../ui/Panel'
import { PropertyGrid, PropertyRow } from '../ui/PropertyGrid'
import { ErrorPanel, SkeletonRows } from '../ui/States'
import { panelId, tabId } from '../ui/format'
import { Tabs } from '../ui/Tabs'
import { ModeBadge } from '../ui/Tag'

export function ConfigPage() {
  const catalog = useCatalog()
  if (catalog.status === 'loading') {
    return (
      <div className="grid gap-px p-3 xl:grid-cols-[350px_minmax(0,1fr)_360px]">
        <Panel label="Market · data">
          <SkeletonRows label="Loading markets" />
        </Panel>
        <Panel label="Strategy">
          <SkeletonRows rows={6} label="Loading strategies" />
        </Panel>
        <Panel label="Costs · risk">
          <SkeletonRows label="Loading limits" />
        </Panel>
      </div>
    )
  }
  if (catalog.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 py-10">
        <ErrorPanel
          error={describeError(catalog.error)}
          action={
            <Button variant="primary" onClick={catalog.retry}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }
  return <ConfigWorkbench catalog={catalog.catalog} />
}

const SOURCES: SourceKind[] = ['crypto', 'stocks', 'csv']

function ConfigWorkbench({ catalog }: { catalog: Catalog }) {
  const { limits, markets, strategies } = catalog
  const providers = markets.providers
  const list = strategies.strategies
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const consent = useConsent()
  const prefill = (location.state as { request?: StoredRequest } | null)?.request ?? null
  const [state, setState] = useState<ConfigState>(() => {
    if (prefill) return stateFromRequest(prefill, providers, list)
    const initial = initialState(providers, list)
    return searchParams.get('market') === 'csv' ? switchSource(initial, 'csv', providers, list) : initial
  })
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<DescribedError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [csv, setCsv] = useState<CsvSelection>({ file: null, timezone: '', columns: null, preview: null })
  const [tab, setTab] = useState('library')

  const market = marketOf(state)
  const available = providersFor(state.source, providers)
  const provider = available.find((info) => info.id === state.provider)
  const strategy = list.find((item) => item.id === state.strategyId)
  const clientErrors = validate(state, strategy, provider, limits)
  const errors: FieldErrors = { ...(touched ? clientErrors : {}), ...serverErrors }
  const liveRangeError = rangeError(state, provider, limits)
  const bars = estimatedBars(state)
  const csvBlocked = state.source === 'csv' && blocksRun(csv.preview)

  const update = (change: Partial<ConfigState>) => {
    setState((current) => ({ ...current, ...change }))
    setServerErrors({})
    setSubmitError(null)
  }
  const onCsvChange = useCallback((selection: CsvSelection) => setCsv(selection), [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    setSubmitError(null)
    if (!consent.request()) return
    if (Object.keys(clientErrors).length > 0 || !strategy) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    if (state.source === 'csv' && (!csv.file || csvBlocked)) return
    setSubmitting(true)
    try {
      const csvRun = state.source === 'csv' && csv.file
      const options = csvRun ? csvRunOptions(state, strategy, csv.preview?.timeframe ?? null) : runBody(state, strategy)
      const created =
        csvRun && csv.file
          ? await postCsvRun({ file: csv.file, timezone: csv.timezone || null, columns: csv.columns }, options)
          : await postRun(options)
      const request = options as RunRequestDocument
      await history
        .put(
          entryFromRequest(created.run_id, request, {
            strategyName: strategy.name,
            market: market,
            sourceMode: csvRun ? 'USER CSV' : (provider?.mode ?? null),
          }),
        )
        .catch(() => undefined)
      navigate(`/app/run/${created.run_id}`, { state: { request } })
    } catch (caught) {
      const problems = caught instanceof ApiError ? fieldProblems(caught.details) : []
      setServerErrors(serverFieldErrors(problems, strategy))
      setSubmitError(describeError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const errorCount = Object.keys(errors).length
  const sourceInfo = state.source === 'csv' ? csv.preview?.source : provider

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only-text">New run</h1>
      {prefill && (
        <p role="status" className="m-0 border-b border-line bg-panel-head px-3 py-1.5 text-[12.5px] text-ink-2">
          Settings copied from a previous run.{" "}
          {prefill.csv ? "Choose the CSV file again: files are never stored." : "Check them, then launch."}
        </p>
      )}
      <div className="grid min-w-0 flex-1 gap-px bg-line xl:grid-cols-[350px_minmax(0,1fr)_360px]">
        <div className="order-2 flex min-w-0 flex-col gap-px bg-app xl:order-1">
          <Panel label="Market · data">
            <div role="radiogroup" aria-label="Market" className="grid grid-cols-3 border-b border-line">
              {SOURCES.map((source) => (
                <button
                  key={source}
                  type="button"
                  role="radio"
                  aria-checked={state.source === source}
                  onClick={() => {
                    setState((current) => switchSource(current, source, providers, list))
                    setServerErrors({})
                  }}
                  className={`label-caps min-h-[34px] border-r border-b-2 border-r-line px-2 transition-colors duration-150 last:border-r-0 ${state.source === source ? 'border-b-accent text-ink' : 'border-b-transparent text-ink-3 hover:text-ink-2'}`}
                >
                  {SOURCE_LABELS[source]}
                </button>
              ))}
            </div>
            {state.source === 'csv' ? (
              <CsvImport
                limits={limits}
                market={state.csvMarket}
                onMarketChange={(next: MarketKind) =>
                  setState((current) => withStrategy({ ...current, csvMarket: next }, current.strategyId, list))
                }
                onChange={onCsvChange}
              />
            ) : (
              <PropertyGrid label="Data">
                <PropertyRow label="Source" htmlFor="data-provider">
                  <Select
                    id="data-provider"
                    value={state.provider}
                    error={errors['data.provider']}
                    onChange={(event) => update(withProvider(state, event.target.value, providers))}
                    options={available.map((info) => ({ value: info.id, label: info.display_name }))}
                  />
                </PropertyRow>
                <PropertyRow label="Symbol" htmlFor="data-symbol">
                  <Select
                    id="data-symbol"
                    value={state.symbol}
                    error={errors['data.symbol']}
                    onChange={(event) => update({ symbol: event.target.value })}
                    options={(provider?.symbols ?? []).map((symbol) => ({ value: symbol, label: symbol }))}
                  />
                </PropertyRow>
                <PropertyRow label="Timeframe" htmlFor="data-timeframe">
                  <Select
                    id="data-timeframe"
                    value={state.timeframe}
                    error={errors['data.timeframe']}
                    onChange={(event) => update({ timeframe: event.target.value as ConfigState['timeframe'] })}
                    options={(provider?.timeframes ?? []).map((timeframe) => ({ value: timeframe, label: timeframe }))}
                  />
                </PropertyRow>
                <PropertyRow label="Period" htmlFor="data-range-start">
                  <DateRangeInput
                    id="data-range"
                    start={state.start}
                    end={state.end}
                    error={errors['data.end'] ?? liveRangeError}
                    hint={`Up to ${limits.range_days[state.provider]?.[state.timeframe] ?? '—'} days for ${state.timeframe}`}
                    onChange={(range) => update(range)}
                  />
                </PropertyRow>
              </PropertyGrid>
            )}
            {sourceInfo && (
              <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-ink">{sourceInfo.display_name}</span>
                  <ModeBadge mode={sourceInfo.mode} />
                </span>
                <span className="text-[12px] leading-snug text-ink-2">{sourceInfo.attribution}</span>
                {sourceInfo.terms_url && (
                  <a className="text-[12px] text-accent-text underline" href={sourceInfo.terms_url} target="_blank" rel="noreferrer">
                    Source terms
                  </a>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div className="order-1 flex min-w-0 flex-col bg-app xl:order-2">
          <Panel label="Strategy" className="flex-1">
            <Tabs
              label="How to define the strategy"
              idPrefix="strategy-source"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'library', label: 'Library' },
                { id: 'words', label: 'Describe in words', soon: true },
              ]}
            />
            <div role="tabpanel" id={panelId('strategy-source', 'library')} aria-labelledby={tabId('strategy-source', 'library')}>
              <StrategyLibrary
                strategies={list}
                market={market}
                selectedId={state.strategyId}
                onSelect={(id) => {
                  setState((current) => withStrategy(current, id, list))
                  setServerErrors({})
                }}
              />
              {(errors.strategy_id ?? clientErrors.strategy_id) && (
                <div className="border-t border-line px-3 py-2">
                  <Hint tone="error">{errors.strategy_id ?? clientErrors.strategy_id}</Hint>
                </div>
              )}
              {strategy && compatibility(strategy, market).ok && (
                <StrategyCard
                  strategy={strategy}
                  market={market}
                  values={state.params}
                  errors={errors}
                  onChange={(name, value) => update({ params: { ...state.params, [name]: value } })}
                />
              )}
            </div>
          </Panel>
        </div>

        <div className="order-3 flex min-w-0 flex-col gap-px bg-app">
          <Panel label="Costs · risk">
            <PropertyGrid label="Costs and risk">
              <PropertyRow label="Fee per fill" htmlFor="cost-fee">
                <NumberInput id="cost-fee" value={state.feePct} onValueChange={(feePct) => update({ feePct })} unit="%" min={0} max={5} step={0.01} error={errors['costs.fee_pct']} />
              </PropertyRow>
              <PropertyRow label="Fixed fee per fill" htmlFor="cost-fixed">
                <NumberInput id="cost-fixed" value={state.fixedFee} onValueChange={(fixedFee) => update({ fixedFee })} min={0} max={10000} error={errors['costs.fixed_fee']} />
              </PropertyRow>
              <PropertyRow label="Slippage per fill" htmlFor="cost-slippage">
                <NumberInput id="cost-slippage" value={state.slippageBps} onValueChange={(slippageBps) => update({ slippageBps })} unit="bps" min={0} max={1000} error={errors['costs.slippage.value']} />
              </PropertyRow>
              <PropertyRow label="Position size" htmlFor="risk-size">
                <NumberInput id="risk-size" value={state.sizingPct} onValueChange={(sizingPct) => update({ sizingPct })} unit="% of capital" min={0.01} max={100} error={errors['sizing.fraction']} />
              </PropertyRow>
              <PropertyRow label="Initial capital" htmlFor="risk-capital">
                <NumberInput id="risk-capital" value={state.capital} onValueChange={(capital) => update({ capital })} min={1} max={1000000000} hint="Account currency" error={errors.initial_capital} />
              </PropertyRow>
              <PropertyRow label="Trades per session" htmlFor="risk-trades">
                <NumberInput id="risk-trades" value={state.maxTradesPerSession} onValueChange={(maxTradesPerSession) => update({ maxTradesPerSession })} min={1} max={1000} step={1} error={errors['risk.max_trades_per_session']} />
              </PropertyRow>
              <PropertyRow label="Session loss limit" htmlFor="risk-session-loss">
                <NumberInput id="risk-session-loss" value={state.maxSessionLossPct} onValueChange={(maxSessionLossPct) => update({ maxSessionLossPct })} unit="%" placeholder="off" hint="Empty = off" error={errors['risk.max_session_loss_pct']} />
              </PropertyRow>
              <PropertyRow label="Drawdown limit" htmlFor="risk-drawdown">
                <NumberInput id="risk-drawdown" value={state.maxDrawdownPct} onValueChange={(maxDrawdownPct) => update({ maxDrawdownPct })} unit="%" placeholder="off" hint="Empty = off" error={errors['risk.max_drawdown_pct']} />
              </PropertyRow>
            </PropertyGrid>
          </Panel>
          <Panel label="Honesty checks">
            <PropertyGrid label="Honesty options">
              <PropertyRow label="Random-entry draws" htmlFor="honesty-draws">
                <NumberInput
                  id="honesty-draws"
                  value={state.randomDraws}
                  onValueChange={(randomDraws) => update({ randomDraws })}
                  min={limits.random_draws.minimum}
                  max={limits.random_draws.maximum}
                  step={1}
                  error={errors['honesty.random_draws']}
                />
              </PropertyRow>
              <PropertyRow label="Parameter sweep" htmlFor="honesty-sweep">
                <Checkbox id="honesty-sweep" label={state.sweep ? 'On' : 'Off'} checked={state.sweep} onChange={(event) => update({ sweep: event.target.checked })} />
              </PropertyRow>
              <PropertyRow label="Random seed" htmlFor="honesty-seed">
                <NumberInput id="honesty-seed" value={state.seed} onValueChange={(seed) => update({ seed })} step={1} min={0} max={4294967295} hint="Same seed, same draws" error={errors['honesty.seed']} />
              </PropertyRow>
            </PropertyGrid>
          </Panel>
          <Panel label="Run summary">
            <PropertyGrid label="Run summary">
              <PropertyRow label="Market">{MARKET_LABELS[market]}</PropertyRow>
              <PropertyRow label="Data">
                {state.source === 'csv' ? (csv.file?.name ?? 'No file yet') : `${state.symbol} · ${state.timeframe}`}
              </PropertyRow>
              <PropertyRow label="Period">
                {state.source === 'csv'
                  ? csv.preview?.start
                    ? `${csv.preview.start.slice(0, 10)} to ${csv.preview.end?.slice(0, 10)}`
                    : '—'
                  : `${state.start} to ${state.end}`}
              </PropertyRow>
              <PropertyRow label="Strategy">{strategy?.name ?? '—'}</PropertyRow>
              <PropertyRow label="Key parameters">
                <span className="break-words">
                  {strategy?.parameters
                    .slice(0, 3)
                    .map((definition) => `${definition.label} ${state.params[definition.name] ?? ''}`)
                    .join(' · ')}
                </span>
              </PropertyRow>
              <PropertyRow label="Source">
                {sourceInfo ? <ModeBadge mode={sourceInfo.mode} /> : '—'}
              </PropertyRow>
              <PropertyRow label="Estimated size">
                {state.source === 'csv'
                  ? csv.preview?.bar_count
                    ? `${formatCount(csv.preview.bar_count)} bars`
                    : '—'
                  : bars !== null
                    ? `≈ ${formatCount(bars)} bars`
                    : '—'}
              </PropertyRow>
            </PropertyGrid>
            <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
              {touched && errorCount > 0 && !submitError && (
                <Hint tone="error">
                  {errorCount === 1 ? 'One field needs attention.' : `${errorCount} fields need attention.`}
                </Hint>
              )}
              {state.source === 'csv' && touched && csvBlocked && (
                <Hint tone="error">{csv.file ? 'Fix the problems in the CSV report first.' : 'Choose a CSV file first.'}</Hint>
              )}
              {submitError && <ErrorPanel error={submitError} compact />}
              <Button type="submit" variant="primary" disabled={submitting} className="min-h-[40px] w-full text-[13px]">
                {submitting ? 'Launching' : 'Run backtest'}
              </Button>
              {!consent.accepted && (
                <Hint>You will be asked to accept the terms of use before the first run.</Hint>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </form>
  )
}
