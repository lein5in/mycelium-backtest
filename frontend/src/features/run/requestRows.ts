import type { RunRequestDocument } from '../../api/result'
import type { StrategyMetadata } from '../../api/types'

export const DASH = '—'

export function value(raw: unknown, unit?: string | null): string {
  if (raw === null || raw === undefined || raw === '') return DASH
  const text = typeof raw === 'number' ? raw.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(raw)
  return unit ? `${text} ${unit}` : text
}

export function parameterRows(
  request: RunRequestDocument | null,
  strategy: StrategyMetadata | undefined,
  parameters: Record<string, number | string> | null,
): { label: string; value: string }[] {
  const chosen = parameters ?? request?.parameters ?? null
  if (strategy) {
    return strategy.parameters.map((definition) => ({
      label: definition.label,
      value: chosen && definition.name in chosen ? value(chosen[definition.name], definition.unit) : `${value(definition.default, definition.unit)} (default)`,
    }))
  }
  return Object.entries(chosen ?? {}).map(([name, raw]) => ({ label: name, value: value(raw) }))
}

export function costRows(request: RunRequestDocument | null): { label: string; value: string }[] {
  if (!request) return []
  const sizing = request.sizing
  return [
    { label: 'Fee', value: request.costs ? `${value(request.costs.fee_pct)} % + ${value(request.costs.fixed_fee)} per fill` : 'server default' },
    { label: 'Slippage', value: request.costs ? `${value(request.costs.slippage.value)} ${request.costs.slippage.unit} per fill` : 'server default' },
    { label: 'Trades per session', value: request.risk ? value(request.risk.max_trades_per_session) : 'strategy default' },
    { label: 'Session loss limit', value: request.risk?.max_session_loss_pct ? `${value(request.risk.max_session_loss_pct)} %` : 'off' },
    { label: 'Drawdown limit', value: request.risk?.max_drawdown_pct ? `${value(request.risk.max_drawdown_pct)} %` : 'off' },
    {
      label: 'Sizing',
      value: sizing?.fraction !== undefined ? `${value(sizing.fraction * 100)} % of capital` : sizing?.percent !== undefined ? `risk ${value(sizing.percent)} %` : 'server default',
    },
    { label: 'Capital', value: value(request.initial_capital) },
    {
      label: 'Honesty',
      value: request.honesty
        ? `${value(request.honesty.random_draws)} draws · sweep ${request.honesty.sweep ? 'on' : 'off'} · seed ${value(request.honesty.seed)}`
        : 'server default',
    },
  ]
}
