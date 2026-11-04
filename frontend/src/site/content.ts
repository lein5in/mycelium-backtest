import strategiesDocument from '../api/fixtures/strategies.json'
import type { Strategies } from '../api/types'

export type RoadmapItem = { title: string; detail: string }

export const AVAILABLE_NOW: RoadmapItem[] = [
  { title: 'Five library strategies', detail: 'Opening Range Breakout, VWAP Mean Reversion, Gap Fade, Donchian Channel Breakout and RSI Mean Reversion, each with documented parameters and a stop-loss.' },
  { title: 'Honesty report', detail: 'Six checks on every run: costs, trade count, result without the best trade, out-of-sample split, random entries, and robustness across periods and parameters.' },
  { title: 'Crypto from public exchange data', detail: 'Candles from public Coinbase Exchange and Kraken endpoints, without an API key, within per-run limits.' },
  { title: 'Stocks and ETFs through your CSV', detail: 'Import your own bar data; it is processed in memory and not kept. Synthetic sample sets, labelled SAMPLE DATA, are there to try the tool.' },
  { title: 'Heatmap chart, calendar, trades and replay', detail: 'Volume heatmap estimated from candles and labelled as such, a P&L calendar, the full trade table and a replay of the finished chart.' },
  { title: 'Local history', detail: 'Past runs are saved in your browser only, with an option to run them again.' },
]

export const SOON: RoadmapItem[] = [
  { title: 'Custom strategy builder', detail: 'Your own rules from a fixed list of prices, indicators and comparisons. The engine accepts them already; the editor is not built yet.' },
  { title: 'Describe a strategy in words', detail: 'Turn a plain description into a strategy spec with your own language-model API key. The result is always a checked spec, never code.' },
  { title: 'Shareable report', detail: 'A link to a read-only copy of a result.' },
  { title: 'News agent', detail: 'Context about the news around a period you test.' },
  { title: 'Forex data and pair strategies', detail: 'Currency data, and strategies that trade two related markets together.' },
]

export const FUTURE: RoadmapItem[] = [
  { title: 'Futures and options data', detail: 'When a data source allows it to be shown to you.' },
  { title: 'A complete trading bot', detail: 'Live execution of a tested strategy. It is a future release and nothing in the current product places orders.' },
]

export type LibraryRow = { name: string; idea: string; type: string; status: 'Available' | 'Soon' }

const TYPES: Record<string, string> = {
  orb: 'Breakout · intraday',
  vwap_mean_reversion: 'Mean reversion · intraday',
  gap_fade: 'Mean reversion · session open',
  donchian_breakout: 'Trend following',
  rsi_mean_reversion: 'Mean reversion',
  custom: 'Your rules',
}

export const LIBRARY: LibraryRow[] = [
  ...(strategiesDocument as Strategies).strategies.map((strategy) => ({
    name: strategy.id === 'custom' ? 'Custom strategy' : strategy.name,
    idea: strategy.summary,
    type: TYPES[strategy.id] ?? '',
    status: strategy.id === 'custom' ? ('Soon' as const) : ('Available' as const),
  })),
  { name: 'Describe it in words', idea: 'Write the idea in plain language and get a strategy spec back, using your own API key.', type: 'Your rules', status: 'Soon' },
]

export type SourceEntry = {
  name: string
  provides: string
  mode: string
  attribution: string
  link: string | null
  status: string
}

export const DATA_SOURCES: SourceEntry[] = [
  {
    name: 'Coinbase Exchange public candles',
    provides: 'Crypto candles (1m, 5m, 15m, 1h, 1d) for the listed pairs, fetched without an API key and cached on the server for a limited time.',
    mode: 'ESTIMATED FROM CANDLES',
    attribution: 'Candles: Coinbase Exchange public market data (no API key).',
    link: 'https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles',
    status: 'Used in the hosted version. Public endpoint, see the provider’s terms.',
  },
  {
    name: 'Kraken public candles',
    provides: 'Crypto candles from Kraken’s latest 720 candles per interval, fetched without an API key, not cached.',
    mode: 'ESTIMATED FROM CANDLES',
    attribution: 'Candles: Kraken public market data (no API key).',
    link: 'https://docs.kraken.com/api/docs/rest-api/get-ohlc-data',
    status: 'Used in the hosted version. Public endpoint, see the provider’s terms.',
  },
  {
    name: 'Kraken public trades',
    provides: 'Individual trades over short recent windows, the only source that can build a heatmap from trades rather than candles.',
    mode: 'FROM TRADES',
    attribution: 'Trades: Kraken public market data (no API key).',
    link: 'https://docs.kraken.com/api/docs/rest-api/get-recent-trades',
    status: 'Not used by runs in this version. Public endpoint, see the provider’s terms.',
  },
  {
    name: 'Synthetic sample sets (SAMPLE-A, SAMPLE-B, SAMPLE-C)',
    provides: 'Stock-like 1-minute and 5-minute bars generated from fixed seeds on the NYSE calendar. They are not real prices.',
    mode: 'SAMPLE DATA',
    attribution: 'SAMPLE DATA: synthetic prices generated by Mycelium Backtest from a fixed seed. Not real market data.',
    link: null,
    status: 'Used in the hosted version.',
  },
  {
    name: 'Your CSV file',
    provides: 'Your own bars for stocks, ETFs or crypto. The file is processed in memory to produce the result and is not kept.',
    mode: 'USER CSV',
    attribution: 'Your data, under the terms you obtained it with.',
    link: null,
    status: 'Used in the hosted version.',
  },
  {
    name: 'Binance public data archive',
    provides: 'Monthly and daily candle files with checksums.',
    mode: 'ESTIMATED FROM CANDLES',
    attribution: 'Candles: Binance public data archive (data.binance.vision), checksum verified.',
    link: 'https://github.com/binance/binance-public-data',
    status: 'Off in the hosted version until its data terms are clarified.',
  },
  {
    name: 'Yahoo Finance (yfinance)',
    provides: 'An adapter for personal local use only.',
    mode: 'PERSONAL USE ONLY',
    attribution: '—',
    link: 'https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html',
    status: 'Never used in the hosted version.',
  },
]

export const TERMS_UPDATED = '4 November 2026'
