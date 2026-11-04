from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

Fraction = Annotated[float, Field(ge=0, le=1)]


class HonestyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    cost_multiplier: Annotated[float, Field(gt=1, le=10)] = 2.0
    costs_pass_share: Fraction = 0.5
    costs_fail_share: Fraction = 0.8

    trade_count_pass: Annotated[int, Field(ge=1, le=100_000)] = 100
    trade_count_warn: Annotated[int, Field(ge=1, le=100_000)] = 30
    split_fraction: Annotated[float, Field(gt=0, lt=1)] = 0.7
    min_trades_per_split: Annotated[int, Field(ge=1, le=10_000)] = 30
    min_trades: Annotated[int, Field(ge=1, le=10_000)] = 30

    best_trade_min_profit_factor: Annotated[float, Field(ge=1, le=10)] = 1.1
    best_trade_max_share: Fraction = 0.4

    out_of_sample_min_pf_ratio: Fraction = 0.7

    period_blocks: Annotated[int, Field(ge=2, le=20)] = 4
    period_min_trades_per_block: Annotated[int, Field(ge=1, le=1_000)] = 10
    period_fail_share: Fraction = 0.8
    period_warn_share: Fraction = 0.5
    period_min_positive_fraction: Fraction = 0.5

    random_seed: Annotated[int, Field(ge=0, le=2**32 - 1)] = 1
    random_draws: Annotated[int, Field(ge=100, le=5_000)] = 1_000
    random_bins: Annotated[int, Field(ge=10, le=200)] = 40
    random_pass_percentile: Annotated[float, Field(ge=0, le=100)] = 95.0
    random_warn_percentile: Annotated[float, Field(ge=0, le=100)] = 80.0

    sweep_values_per_parameter: Annotated[int, Field(ge=3, le=20)] = 5
    sweep_relative_spacing: Annotated[float, Field(gt=0, le=1)] = 0.1
    sweep_max_combinations: Annotated[int, Field(ge=1, le=400)] = 400
    sweep_time_budget_seconds: Annotated[float, Field(gt=0, le=600)] = 60.0
    sweep_pass_neighbours: Fraction = 0.7
    sweep_warn_neighbours: Fraction = 0.4
    sweep_spike_ratio: Fraction = 0.5

    @model_validator(mode="after")
    def ordered(self) -> "HonestyConfig":
        problems = []
        if self.costs_pass_share > self.costs_fail_share:
            problems.append("costs_pass_share must not exceed costs_fail_share")
        if self.trade_count_warn > self.trade_count_pass:
            problems.append("trade_count_warn must not exceed trade_count_pass")
        if self.period_warn_share > self.period_fail_share:
            problems.append("period_warn_share must not exceed period_fail_share")
        if self.random_warn_percentile > self.random_pass_percentile:
            problems.append("random_warn_percentile must not exceed random_pass_percentile")
        if self.sweep_warn_neighbours > self.sweep_pass_neighbours:
            problems.append("sweep_warn_neighbours must not exceed sweep_pass_neighbours")
        if problems:
            raise ValueError("; ".join(problems))
        return self
