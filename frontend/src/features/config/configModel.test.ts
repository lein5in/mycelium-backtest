import { describe, expect, it } from 'vitest'
import limitsFixture from '../../api/fixtures/limits.json'
import marketsFixture from '../../api/fixtures/markets.json'
import strategiesFixture from '../../api/fixtures/strategies.json'
import type { Limits, Markets, ParamDef, Strategies } from '../../api/types'
import {
  compatibility,
  csvRunOptions,
  estimatedBars,
  initialState,
  paramError,
  providersFor,
  rangeError,
  runBody,
  serverFieldErrors,
  switchSource,
  validate,
  withProvider,
  withStrategy,
} from './configModel'

const limits = limitsFixture as Limits
const providers = (marketsFixture as Markets).providers
const strategies = (strategiesFixture as Strategies).strategies
const byId = (id: string) => {
  const found = strategies.find((item) => item.id === id)
  if (!found) throw new Error(`missing strategy ${id}`)
  return found
}
const param = (id: string, predicate: (p: ParamDef) => boolean) => {
  const found = byId(id).parameters.find(predicate)
  if (!found) throw new Error(`missing parameter on ${id}`)
  return found
}
const TODAY = new Date('2026-11-03T12:00:00Z')

describe('data picker', () => {
  it('offers sample sets for stocks, exchanges for crypto, nothing for CSV', () => {
    expect(providersFor('stocks', providers).map((p) => p.id)).toEqual(['samples'])
    expect(providersFor('crypto', providers).map((p) => p.id)).toEqual(['coinbase', 'kraken'])
    expect(providersFor('csv', providers)).toEqual([])
  })

  it('starts on SAMPLE-A 5m with ORB and keeps symbols and timeframes valid when the source changes', () => {
    const state = initialState(providers, strategies, TODAY)
    expect(state).toMatchObject({ source: 'stocks', provider: 'samples', symbol: 'SAMPLE-A', timeframe: '5m', strategyId: 'orb' })
    const crypto = switchSource(state, 'crypto', providers, strategies, TODAY)
    expect(crypto).toMatchObject({ provider: 'coinbase', symbol: 'BTC-USD', timeframe: '1h', end: '2026-11-03', start: '2026-09-04' })
    const kraken = withProvider({ ...crypto, timeframe: '1h' }, 'kraken', providers)
    expect(kraken.timeframe).toBe('1h')
  })
})

describe('compatibility', () => {
  it('disables Gap Fade on crypto with the reason, and Custom as not available yet', () => {
    const gap = byId('gap_fade')
    expect(compatibility(gap, 'us_equity')).toEqual({ ok: true })
    const refused = compatibility(gap, 'crypto_24x7')
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.reason).toContain('Gap Fade supports Stocks & ETFs only')
    expect(compatibility(byId('custom'), 'us_equity').ok).toBe(false)
  })

  it('flags an incompatible selection after a market switch', () => {
    const state = withStrategy(initialState(providers, strategies, TODAY), 'gap_fade', strategies)
    const crypto = switchSource(state, 'crypto', providers, strategies, TODAY)
    const provider = providers.find((p) => p.id === crypto.provider)
    expect(validate(crypto, byId('gap_fade'), provider, limits).strategy_id).toContain('supports Stocks & ETFs only')
  })
})

describe('parameters and ranges', () => {
  it('uses market defaults and mirrors the API ranges and steps', () => {
    const stocks = withStrategy(initialState(providers, strategies, TODAY), 'rsi_mean_reversion', strategies)
    expect(stocks.params.directions).toBe('long')
    const crypto = switchSource(stocks, 'crypto', providers, strategies, TODAY)
    expect(crypto.params.directions).toBe('both')
    const period = param('rsi_mean_reversion', (p) => p.name === 'rsi_period')
    expect(paramError(period, '1')).toBe('At least 2.')
    expect(paramError(period, '2.5')).toBe('Enter a whole number.')
    expect(paramError(period, '14')).toBeNull()
    const stop = param('rsi_mean_reversion', (p) => p.type === 'float')
    expect(paramError(stop, String((stop.minimum ?? 0) + (stop.step ?? 1) / 3))).toMatch(/^Use steps of/)
  })

  it('checks the date range against the limit for the timeframe', () => {
    const state = initialState(providers, strategies, TODAY)
    const samples = providers.find((p) => p.id === 'samples')
    expect(rangeError(state, samples, limits)).toBeNull()
    expect(rangeError({ ...state, end: '2026-01-02' }, samples, limits)).toContain('limited to 730 days')
    expect(rangeError({ ...state, end: state.start }, samples, limits)).toBe('The end must be after the start.')
  })

  it('validates costs, risk and honesty bounds', () => {
    const state = { ...initialState(providers, strategies, TODAY), feePct: '9', randomDraws: '50', maxDrawdownPct: '' }
    const errors = validate(state, byId('orb'), providers.find((p) => p.id === 'samples'), limits)
    expect(errors['costs.fee_pct']).toBe('Between 0 and 5.')
    expect(errors['honesty.random_draws']).toBe('Between 100 and 5000.')
    expect(errors['risk.max_drawdown_pct']).toBeUndefined()
  })
})

describe('request and summary', () => {
  it('builds the run body the API expects', () => {
    const state = initialState(providers, strategies, TODAY)
    const body = runBody(state, byId('orb'))
    expect(body.data).toEqual({
      provider: 'samples',
      symbol: 'SAMPLE-A',
      timeframe: '5m',
      start: '2024-01-02T00:00:00Z',
      end: '2024-04-01T00:00:00Z',
    })
    expect(body.costs).toEqual({ fee_pct: 0.05, fixed_fee: 0, slippage: { unit: 'bps', value: 2 } })
    expect(body.sizing).toEqual({ type: 'fixed_fraction', fraction: 1 })
    expect(body.risk.max_session_loss_pct).toBeNull()
    expect(typeof body.parameters.range_minutes).toBe('number')
    const csv = csvRunOptions({ ...state, source: 'csv', csvMarket: 'crypto_24x7' }, byId('orb'), '5m')
    expect(csv.csv).toEqual({ market: 'crypto_24x7', timeframe: '5m' })
  })

  it('estimates the size of the run', () => {
    const state = initialState(providers, strategies, TODAY)
    expect(estimatedBars(state)).toBe(4836)
    const crypto = switchSource(state, 'crypto', providers, strategies, TODAY)
    expect(estimatedBars(crypto)).toBe(1440)
    expect(estimatedBars({ ...state, source: 'csv' })).toBeNull()
  })

  it('places server problems next to their fields', () => {
    const errors = serverFieldErrors(
      [
        { field: 'data.end', message: '5m data is limited to 730 days per run.' },
        { field: 'parameters', message: 'range_minutes must be a multiple of 5 from 5' },
        { field: 'costs.fee_pct', message: 'Input should be less than or equal to 5' },
      ],
      byId('orb'),
    )
    expect(Object.keys(errors).sort()).toEqual(['costs.fee_pct', 'data.end', 'parameters.range_minutes'])
  })
})
