from typing import Literal

ErrorCode = Literal[
    "invalid_request",
    "not_found",
    "range_too_large",
    "range_invalid",
    "no_data",
    "file_too_large",
    "csv_invalid",
    "symbol_not_supported",
    "market_not_compatible",
    "provider_unavailable",
    "provider_rate_limited",
    "rate_limited",
    "capacity_busy",
    "run_timeout",
    "run_cancelled",
    "run_not_found",
    "run_not_finished",
    "internal_error",
]
