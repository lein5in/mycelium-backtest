import type { MarketKind, ParamDef, StrategyMetadata } from '../../api/types'
import { NumberInput, Select } from '../../ui/Field'
import { PropertyGrid, PropertyRow } from '../../ui/PropertyGrid'
import { MARKET_LABELS } from '../config/configModel'
import { Schematic } from './Schematic'

type StrategyCardProps = {
  strategy: StrategyMetadata
  market: MarketKind
  values: Record<string, string>
  errors: Record<string, string>
  onChange: (name: string, value: string) => void
}

function ParameterControl({
  definition,
  value,
  error,
  onChange,
}: {
  definition: ParamDef
  value: string
  error: string | undefined
  onChange: (value: string) => void
}) {
  const id = `param-${definition.name}`
  if (definition.type === 'choice') {
    return (
      <Select
        id={id}
        value={value}
        error={error}
        onChange={(event) => onChange(event.target.value)}
        options={(definition.choices ?? []).map((choice) => ({ value: choice, label: choice }))}
      />
    )
  }
  return (
    <NumberInput
      id={id}
      value={value}
      error={error}
      onValueChange={onChange}
      unit={definition.unit}
      min={definition.minimum}
      max={definition.maximum}
      step={definition.step}
    />
  )
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="label-caps m-0 font-medium text-ink-3">{title}</h4>
      <p className="m-0 max-w-prose text-[13px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

export function StrategyCard({ strategy, market, values, errors, onChange }: StrategyCardProps) {
  return (
    <article aria-labelledby="strategy-card-title" className="flex flex-col border-t border-line">
      <div className="flex flex-col gap-4 px-3 py-3 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h3 id="strategy-card-title" className="m-0 text-[16px] font-semibold text-ink">
            {strategy.name}
          </h3>
          <p className="m-0 max-w-prose text-[13.5px] leading-relaxed text-ink">{strategy.idea}</p>
          <Section title="When it tends to work">{strategy.works_when}</Section>
          <Section title="When it tends to fail">{strategy.fails_when}</Section>
          <div className="flex flex-col gap-1">
            <h4 className="label-caps m-0 font-medium text-ink-3">Markets</h4>
            <p className="m-0 font-mono text-[12px] text-ink-2">
              {strategy.markets.map((item) => MARKET_LABELS[item]).join(' · ')}
              {strategy.market_note ? ` — ${strategy.market_note}` : ''}
            </p>
          </div>
        </div>
        <div className="w-full shrink-0 lg:w-[300px]">
          <Schematic strategyId={strategy.id} />
        </div>
      </div>
      <div className="border-t border-line">
        <h4 className="label-caps m-0 border-b border-line bg-panel-head px-3 py-1.5 font-medium text-ink-3">
          Parameters · {MARKET_LABELS[market]} defaults
        </h4>
        <PropertyGrid label={`${strategy.name} parameters`}>
          {strategy.parameters.map((definition) => (
            <PropertyRow
              key={definition.name}
              label={definition.label}
              htmlFor={`param-${definition.name}`}
              hint={<span className="text-[11.5px] leading-snug text-ink-3">{definition.description}</span>}
            >
              <ParameterControl
                definition={definition}
                value={values[definition.name] ?? ''}
                error={errors[`parameters.${definition.name}`]}
                onChange={(value) => onChange(definition.name, value)}
              />
            </PropertyRow>
          ))}
        </PropertyGrid>
      </div>
      <p className="m-0 border-t border-line px-3 py-2 text-[12px] leading-relaxed text-warn-text">{strategy.note}</p>
    </article>
  )
}
