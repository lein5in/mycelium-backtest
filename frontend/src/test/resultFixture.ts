import type { CheckResult, RunResultPayload, TradeRow } from '../api/result'
import { CHECK_IDS } from '../api/runEvents'

const START = Date.UTC(2024, 0, 2, 14, 30) / 1000
const BAR = 300

export function tradeRow(index: number, netPnl: number, overrides: Partial<TradeRow> = {}): TradeRow {
  const entry = 10 + index * 12
  const exit = entry + 6
  const iso = (bar: number) => new Date((START + bar * BAR) * 1000).toISOString()
  return {
    side: index % 2 === 0 ? 'long' : 'short',
    signal_index: entry - 1,
    entry_index: entry,
    exit_index: exit,
    signal_time: iso(entry - 1),
    entry_time: iso(entry),
    exit_time: iso(exit),
    exit_fill: 'intrabar',
    session: '2024-01-02',
    exit_session: '2024-01-02',
    quantity: 100,
    entry_price: 50 + index * 0.1,
    exit_price: 50 + index * 0.1 + netPnl / 100,
    stop_price: 49,
    target_price: null,
    exit_reason: index === 2 ? 'exit_signal' : netPnl > 0 ? 'target' : 'stop',
    gross_pnl: netPnl + 3,
    fees: 2,
    slippage_cost: 1,
    net_pnl: netPnl,
    bars_held: 7,
    ...overrides,
  }
}

function check(id: (typeof CHECK_IDS)[number], status: CheckResult['status'], insufficient = false): CheckResult {
  return {
    id,
    status,
    headline: `${id} headline`,
    detail: `${id} detail`,
    insufficient_data: insufficient,
    measured: id === 'without_best_trade' ? { profit_factor_without_best: null } : {},
    thresholds: {},
  }
}

export function makeResult(options: { pnls?: number[]; profitFactor?: number | null } = {}): RunResultPayload {
  const pnls = options.pnls ?? [120, -40, 60, -30, 15]
  const trades = pnls.map((pnl, index) => tradeRow(index, pnl))
  const net = pnls.reduce((sum, pnl) => sum + pnl, 0)
  const bars = 80
  const time = Array.from({ length: bars }, (_, index) => START + index * BAR)
  const close = time.map((_, index) => 50 + Math.sin(index / 6))
  return {
    schema_version: 1,
    run_id: 'run-fixture',
    request: {
      strategy_id: 'orb',
      parameters: { range_minutes: 30, min_range_atr: 0.5, target_r: 1.5, directions: 'both' },
      costs: { fee_pct: 0.05, fixed_fee: 0, slippage: { unit: 'bps', value: 2 } },
      risk: { max_trades_per_session: 1, max_session_loss_pct: null, max_drawdown_pct: null },
      sizing: { type: 'fixed_fraction', fraction: 1 },
      initial_capital: 10_000,
      honesty: { random_draws: 500, seed: 1, sweep: true },
      data: { provider: 'samples', symbol: 'SAMPLE-A', timeframe: '5m', start: '2024-01-02T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    },
    source: {
      provider: 'samples',
      display_name: 'Synthetic sample data',
      terms_url: null,
      attribution: 'SAMPLE DATA',
      mode: 'SAMPLE DATA',
      symbol: 'SAMPLE-A',
      market: 'us_equity',
      timeframe: '5m',
      start: '2024-01-02T00:00:00Z',
      end: '2024-02-01T00:00:00Z',
    },
    gaps: { missing_bars: 0, gap_count: 0, gaps: [], note: 'n' },
    data_warnings: [],
    csv_report: null,
    result: {
      strategy: 'Opening Range Breakout',
      market: 'us_equity',
      timeframe: '5m',
      bar_count: bars,
      first_bar: new Date(START * 1000).toISOString(),
      last_bar: new Date((START + (bars - 1) * BAR) * 1000).toISOString(),
      warmup_bars: 2,
      trades,
      daily_equity: [{ session: '2024-01-02', equity: 10_000 + net, drawdown_pct: 0.4 }],
      metrics: {
        summary: {
          trade_count: trades.length,
          net_pnl: net,
          return_pct: net / 100,
          win_rate_pct: (100 * pnls.filter((pnl) => pnl > 0).length) / pnls.length,
          average_win: 65,
          average_loss: -35,
          expectancy: net / pnls.length,
          profit_factor: options.profitFactor === undefined ? 2.5 : options.profitFactor,
          longest_losing_streak: 1,
          realised_max_drawdown_pct: 0.4,
          realised_max_drawdown: 40,
        },
        initial_capital: 10_000,
        final_equity: 10_000 + net,
        max_drawdown_pct: 0.41,
        max_drawdown: 41,
        exposure_pct: 20,
        sharpe: null,
        cagr_pct: null,
        annual_volatility_pct: null,
        annualisation_days: 252,
        period_days: 1,
      },
      halted: null,
      diagnostics: { signals: 10, entries: trades.length, skipped: {} },
      assumptions: ['Spot instruments.'],
    },
    report: {
      run: {
        strategy_id: 'orb',
        strategy_name: 'Opening Range Breakout',
        parameters: { range_minutes: 30 },
        market: 'us_equity',
        timeframe: '5m',
        first_bar: new Date(START * 1000).toISOString(),
        last_bar: new Date((START + (bars - 1) * BAR) * 1000).toISOString(),
        bar_count: bars,
        trade_count: trades.length,
      },
      checks: [
        check('costs', 'PASS'),
        check('trade_count', 'FAIL', true),
        check('without_best_trade', 'WARN'),
        check('out_of_sample', 'WARN', true),
        check('versus_random', 'FAIL'),
        check('robustness', 'PASS'),
      ],
      verdict: {
        id: 'NOT_CREDIBLE',
        label: 'Not credible',
        rule: 'trade_count_fail',
        sentence: 'Not credible because the trade-count and versus-random checks fail.',
        rules: [
          { id: 'costs_fail', verdict: 'NOT_CREDIBLE', description: 'The costs check fails.', matched: false },
          { id: 'trade_count_fail', verdict: 'NOT_CREDIBLE', description: 'The trade-count check fails.', matched: true },
        ],
      },
      config: { random_pass_percentile: 95, random_draws: 500 },
      random_entries: {
        draws: 500,
        seed: 1,
        trades_per_draw: trades.length,
        eligible_entry_bars: 70,
        real_net_pnl: net,
        percentile: 62.5,
        mean: 10,
        median: 12,
        p5: -100,
        p95: 140,
        histogram: { edges: [-150, -100, -50, 0, 50, 100, 150], counts: [10, 60, 140, 160, 100, 30], real_value: net, real_bin: 4 },
      },
      robustness: {
        period: { status: 'PASS', insufficient_data: true, blocks: [], max_share: null, positive_fraction: null, total_net_pnl: net },
        parameters: { status: 'PASS', insufficient_data: false, reason: 'ok' },
      },
      sweep: {
        axes: [
          { name: 'range_minutes', label: 'Opening range', values: [20, 25, 30], chosen: 25 },
          { name: 'target_r', label: 'Target', values: [1, 1.5], chosen: 1.5 },
        ],
        cells: [0, 1, 2].flatMap((a) =>
          [0, 1].map((b) => ({
            coordinates: [a, b],
            values: { range_minutes: [20, 25, 30][a] ?? 0, target_r: [1, 1.5][b] ?? 0 },
            state: a === 2 && b === 0 ? ('invalid' as const) : ('ok' as const),
            net_pnl: a === 2 && b === 0 ? null : (a - 1) * 100 + b * 40,
            profit_factor: 1.1,
            trade_count: 5,
            message: a === 2 && b === 0 ? 'range too long' : null,
          })),
        ),
        chosen: [1, 1],
        best: [2, 1],
        combinations: 6,
        completed: 6,
        stopped_by_budget: false,
        elapsed_seconds: 0.4,
        neighbour_count: 5,
        profitable_neighbour_fraction: 0.6,
        neighbour_median_share: 0.5,
        chosen_is_spike: false,
        best_is_spike: false,
      },
      calendar: {
        rule: 'Each trade counts on the session date of its exit bar.',
        timezone: 'America/New_York',
        months: [],
      },
      assumptions: ['Past results do not predict future results.'],
    },
    heatmap: {
      mode: 'ESTIMATED_FROM_CANDLES',
      time_bucket_seconds: BAR,
      price_bucket: 0.5,
      columns: bars,
      rows: 4,
      first_time: START,
      lowest_price: 48.5,
      intensity: new Array(bars * 4).fill(0).map((_, index) => (index % 7) / 7),
      buy_ratio: new Array(bars * 4).fill(0.5),
      profile_buy: [1, 2, 3, 1],
      profile_sell: [1, 1, 2, 1],
      poc_row: 2,
      poc_price: 49.75,
      total_volume: 100,
      method: { label: 'ESTIMATED FROM CANDLES', volume_rule: 'r', normalisation: 'n' },
    },
    costs: { fills: trades.length * 2, fees: 10, slippage: 5, gross_pnl: net + 15, net_pnl: net },
    bars: {
      time,
      open: close,
      high: close.map((value) => value + 0.2),
      low: close.map((value) => value - 0.2),
      close,
      volume: time.map(() => 1_000),
    },
    limits: {
      bars_total: bars,
      bars_returned: bars,
      bars_first_index: 0,
      bars_truncated: false,
      trades_total: trades.length,
      trades_returned: trades.length,
      trades_truncated: false,
      note: null,
    },
  }
}
