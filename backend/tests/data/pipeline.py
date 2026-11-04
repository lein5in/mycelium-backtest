from dataclasses import dataclass

from app.data.heatmap import HeatmapGrid, grid_from_candles
from app.data.models import DataResult
from app.engine import BacktestConfig, run_backtest
from app.engine.models import CostModel, SlippageBps
from app.engine.sessions import Crypto24x7Session, UsEquitySession
from app.honesty.config import HonestyConfig
from app.honesty.model import HonestyReport
from app.honesty.report import HonestyInput, build_report
from app.honesty.sweep import SweepRequest
from app.strategies.registry import build_spec, validate_parameters


@dataclass(frozen=True)
class PipelineOutcome:
    data: DataResult
    report: HonestyReport
    grid: HeatmapGrid

    def summary(self) -> str:
        source = self.data.source
        return (
            f"{source.provider} {source.symbol} {source.timeframe} [{source.mode}]: "
            f"{self.data.bars.size:,} bars, {self.data.gaps.missing_bars:,} missing, "
            f"{self.report.run.trade_count} trades, verdict {self.report.verdict.id}, "
            f"heatmap {self.grid.columns}x{self.grid.rows} {self.grid.mode}"
        )


def run_pipeline(
    data: DataResult, strategy_id: str, values: dict | None = None, draws: int = 300
) -> PipelineOutcome:
    market = data.source.market
    session = Crypto24x7Session() if market == "crypto_24x7" else UsEquitySession()
    config = BacktestConfig(
        session=session, costs=CostModel(fee_pct=0.05, slippage=SlippageBps(value=2))
    )
    params = validate_parameters(strategy_id, values or {}, market)
    spec = build_spec(strategy_id, params, market)
    output = run_backtest(data.bars, spec, config)
    inputs = HonestyInput(
        data.bars,
        spec,
        config,
        output,
        strategy_id,
        params,
        SweepRequest(strategy_id, params, market),
    )
    report = build_report(inputs, HonestyConfig(random_draws=draws))
    return PipelineOutcome(data=data, report=report, grid=grid_from_candles(data.bars).grid)
