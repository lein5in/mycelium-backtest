from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.engine.sessions import Crypto24x7Session, MarketSession, UsEquitySession

PositiveFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Instrument(Frozen):
    symbol: Annotated[str, Field(min_length=1, max_length=32)] = "SYNTH"
    tick_size: Annotated[float, Field(gt=0, le=1_000)] = 0.01
    quantity_step: Annotated[float, Field(gt=0, le=1_000_000)] | None = None


class SlippageTicks(Frozen):
    unit: Literal["ticks"] = "ticks"
    value: Annotated[float, Field(ge=0, le=1_000)] = 0.0


class SlippageBps(Frozen):
    unit: Literal["bps"] = "bps"
    value: Annotated[float, Field(ge=0, le=1_000)] = 0.0


Slippage = Annotated[SlippageTicks | SlippageBps, Field(discriminator="unit")]


class CostModel(Frozen):
    fee_pct: Annotated[float, Field(ge=0, le=5)] = 0.0
    fixed_fee: Annotated[float, Field(ge=0, le=10_000)] = 0.0
    slippage: Slippage = Field(default_factory=SlippageTicks)

    def slip(self, price: float, tick_size: float) -> float:
        if self.slippage.unit == "ticks":
            return self.slippage.value * tick_size
        return price * self.slippage.value / 10_000.0

    def fee(self, notional: float) -> float:
        return notional * self.fee_pct / 100.0 + self.fixed_fee


class FixedFraction(Frozen):
    type: Literal["fixed_fraction"] = "fixed_fraction"
    fraction: Annotated[float, Field(gt=0, le=1)] = 1.0


class RiskPercent(Frozen):
    type: Literal["risk_percent"] = "risk_percent"
    percent: Annotated[float, Field(gt=0, le=100)] = 1.0


Sizing = Annotated[FixedFraction | RiskPercent, Field(discriminator="type")]


class RiskLimits(Frozen):
    max_session_loss_pct: Annotated[float, Field(gt=0, le=100)] | None = None
    max_drawdown_pct: Annotated[float, Field(gt=0, le=100)] | None = None
    max_trades_per_session: Annotated[int, Field(ge=1, le=1_000)] = 1


class BacktestConfig(Frozen):
    session: MarketSession = Field(default_factory=UsEquitySession)
    instrument: Instrument = Field(default_factory=Instrument)
    costs: CostModel = Field(default_factory=CostModel)
    sizing: Sizing = Field(default_factory=FixedFraction)
    risk: RiskLimits = Field(default_factory=RiskLimits)
    initial_capital: Annotated[float, Field(gt=0, le=1e12)] = 10_000.0
    compounding: bool = False

    @property
    def annualisation_days(self) -> int:
        return 365 if isinstance(self.session, Crypto24x7Session) else 252
