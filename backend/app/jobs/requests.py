from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue

from app.config import Settings
from app.data.csv_import import MAX_ROWS as CSV_MAX_ROWS
from app.data.csv_import import CsvOptions
from app.data.models import ProviderInfo
from app.engine.bars import Timeframe
from app.engine.models import CostModel, RiskLimits, Sizing, SlippageBps
from app.engine.sessions import MarketKind
from app.errors import ApiError, classify
from app.honesty.config import HonestyConfig
from app.strategies.base import StrategyId
from app.strategies.registry import build_spec, get_strategy, validate_parameters

MAX_PARAMETERS = 32
MIN_DRAWS = 100
MAX_DRAWS = 5_000
RUNNABLE_KINDS = ("candles", "sample")
HONESTY_DEFAULTS = HonestyConfig()


def default_costs() -> CostModel:
    return CostModel(fee_pct=0.05, slippage=SlippageBps(value=2))


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class DataSourceRequest(Strict):
    provider: Annotated[str, Field(pattern=r"^[a-z_]{1,32}$")]
    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    timeframe: Timeframe
    start: AwareDatetime
    end: AwareDatetime


class HonestyOptions(Strict):
    random_draws: Annotated[int, Field(ge=MIN_DRAWS, le=MAX_DRAWS)] = HONESTY_DEFAULTS.random_draws
    seed: Annotated[int, Field(ge=0, le=2**32 - 1)] = HONESTY_DEFAULTS.random_seed
    sweep: bool = True


class RunOptions(Strict):
    strategy_id: StrategyId
    parameters: dict[str, JsonValue] | None = None
    costs: CostModel = Field(default_factory=default_costs)
    risk: RiskLimits | None = None
    sizing: Sizing | None = None
    initial_capital: Annotated[float, Field(gt=0, le=1e9)] = 10_000.0
    tick_size: Annotated[float, Field(gt=0, le=1_000)] = 0.01
    quantity_step: Annotated[float, Field(gt=0, le=1_000_000)] | None = None
    session_anchor: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    honesty: HonestyOptions = Field(default_factory=HonestyOptions)


class RunRequest(RunOptions):
    data: DataSourceRequest


class CsvRunOptions(RunOptions):
    csv: CsvOptions = Field(default_factory=CsvOptions)


SourceKind = Literal["provider", "csv"]


class Job(Strict):
    kind: SourceKind
    market: MarketKind
    options: RunRequest | CsvRunOptions
    parameters: dict[str, JsonValue]


def field_error(field: str, message: str, code: str = "invalid_request") -> ApiError:
    return ApiError(code, message, details={"problems": [{"field": field, "message": message}]})


def runnable_provider(provider_id: str, providers: list[ProviderInfo]) -> ProviderInfo:
    for info in providers:
        if info.id == provider_id and info.enabled and info.kind in RUNNABLE_KINDS:
            return info
    raise ApiError(
        "provider_unavailable",
        f"The data source {provider_id!r} is not offered here.",
        details={"problems": [{"field": "data.provider", "message": "not offered"}]},
    )


def check_source(source: DataSourceRequest, info: ProviderInfo) -> None:
    if source.symbol not in info.symbols:
        offered = ", ".join(info.symbols)
        raise field_error(
            "data.symbol",
            f"{source.symbol} is not offered by {info.display_name}; available: {offered}.",
            "symbol_not_supported",
        )
    if source.timeframe not in info.timeframes:
        offered = ", ".join(info.timeframes)
        raise field_error(
            "data.timeframe", f"{info.display_name} offers {offered}.", "invalid_request"
        )
    if source.end <= source.start:
        raise field_error("data.end", "The end must be after the start.", "range_invalid")
    limit = info.max_range_days.get(source.timeframe)
    days = (source.end - source.start).total_seconds() / 86_400
    if limit is not None and days > limit:
        raise field_error(
            "data.end",
            f"{source.timeframe} data is limited to {limit:g} days per run; "
            "choose a shorter range.",
            "range_too_large",
        )


def check_strategy(options: RunOptions, market: MarketKind) -> dict[str, JsonValue]:
    if options.strategy_id != "custom" and len(options.parameters or {}) > MAX_PARAMETERS:
        raise field_error("parameters", f"At most {MAX_PARAMETERS} parameters are accepted.")
    try:
        parameters = validate_parameters(options.strategy_id, options.parameters or {}, market)
        build_spec(options.strategy_id, parameters, market)
    except Exception as error:
        raise classify(error) from error
    return dict(parameters)


def default_risk(strategy_id: str) -> RiskLimits:
    return get_strategy(strategy_id).default_risk


def provider_job(request: RunRequest, providers: list[ProviderInfo]) -> Job:
    info = runnable_provider(request.data.provider, providers)
    check_source(request.data, info)
    market = info.markets[0]
    parameters = check_strategy(request, market)
    return Job(kind="provider", market=market, options=request, parameters=parameters)


def csv_job(options: CsvRunOptions) -> Job:
    market = options.csv.market
    parameters = check_strategy(options, market)
    return Job(kind="csv", market=market, options=options, parameters=parameters)


class DrawLimits(Strict):
    minimum: int
    maximum: int
    default: int


class LimitsDocument(Strict):
    range_days: dict[str, dict[str, float]]
    csv_max_bytes: int
    csv_max_rows: int
    json_max_bytes: int
    max_parameters: int
    random_draws: DrawLimits
    sweep_max_combinations: int
    sweep_values_per_parameter: int
    run_timeout_seconds: float
    retention_minutes: float
    runs_per_hour_per_ip: int
    concurrent_runs_per_ip: int
    max_result_bars: int
    max_result_trades: int


def limits_document(settings: Settings, providers: list[ProviderInfo]) -> LimitsDocument:
    return LimitsDocument(
        range_days={
            info.id: dict(info.max_range_days)
            for info in providers
            if info.enabled and info.kind in RUNNABLE_KINDS
        },
        csv_max_bytes=settings.max_csv_bytes,
        csv_max_rows=CSV_MAX_ROWS,
        json_max_bytes=settings.max_json_bytes,
        max_parameters=MAX_PARAMETERS,
        random_draws=DrawLimits(
            minimum=MIN_DRAWS, maximum=MAX_DRAWS, default=HONESTY_DEFAULTS.random_draws
        ),
        sweep_max_combinations=HONESTY_DEFAULTS.sweep_max_combinations,
        sweep_values_per_parameter=HONESTY_DEFAULTS.sweep_values_per_parameter,
        run_timeout_seconds=settings.run_timeout_seconds,
        retention_minutes=settings.retention_minutes,
        runs_per_hour_per_ip=settings.runs_per_hour_per_ip,
        concurrent_runs_per_ip=settings.concurrent_runs_per_ip,
        max_result_bars=settings.max_result_bars,
        max_result_trades=settings.max_result_trades,
    )
