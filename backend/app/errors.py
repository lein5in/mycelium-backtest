from dataclasses import dataclass, field

from pydantic import JsonValue, ValidationError

from app.data import errors as data_errors
from app.data.csv_import import CsvImportError
from app.engine.backtest import IncompatibleMarketError
from app.engine.bars import BarsValidationError
from app.engine.sessions import SessionError
from app.engine.signals import SpecError
from app.error_codes import ErrorCode
from app.strategies.custom import CustomStrategyError
from app.strategies.params import ParameterError
from app.strategies.registry import UnknownStrategyError

STATUS: dict[str, int] = {
    "invalid_request": 400,
    "not_found": 404,
    "range_too_large": 400,
    "range_invalid": 400,
    "no_data": 404,
    "file_too_large": 413,
    "csv_invalid": 422,
    "symbol_not_supported": 400,
    "market_not_compatible": 400,
    "provider_unavailable": 503,
    "provider_rate_limited": 503,
    "rate_limited": 429,
    "capacity_busy": 503,
    "run_timeout": 504,
    "run_cancelled": 409,
    "run_not_found": 404,
    "run_not_finished": 409,
    "internal_error": 500,
}

INTERNAL_MESSAGE = "Something went wrong on our side. Quote the request id if you report it."
MAX_MESSAGE = 200
MAX_PROBLEMS = 50

DATA_CODES: dict[str, ErrorCode] = {
    "network": "provider_unavailable",
    "rate_limited": "provider_rate_limited",
    "not_found": "no_data",
    "bad_payload": "provider_unavailable",
    "out_of_range": "range_invalid",
    "invalid_symbol": "symbol_not_supported",
    "unsupported": "invalid_request",
    "provider_disabled": "provider_unavailable",
    "busy": "capacity_busy",
    "csv_invalid": "csv_invalid",
}


@dataclass
class ApiError(Exception):
    code: ErrorCode
    message: str
    stage: str | None = None
    details: JsonValue = None
    retry_after: int | None = None
    headers: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.message = self.message[:MAX_MESSAGE]
        super().__init__(self.code)

    @property
    def status(self) -> int:
        return STATUS[self.code]


def field_problems(error: ValidationError, prefix: tuple[str | int, ...] = ()) -> list[dict]:
    problems = []
    for item in error.errors(include_url=False, include_input=False, include_context=False)[
        :MAX_PROBLEMS
    ]:
        location = [str(part) for part in (*prefix, *item.get("loc", ()))]
        problems.append({"field": ".".join(location), "message": str(item.get("msg", ""))[:160]})
    return problems


def _problem_list(problems: list[str], field_name: str) -> list[dict]:
    return [{"field": field_name, "message": problem[:160]} for problem in problems[:MAX_PROBLEMS]]


def classify(error: BaseException, stage: str | None = None) -> ApiError:
    if isinstance(error, ApiError):
        return error
    if isinstance(error, CsvImportError):
        return ApiError(
            "csv_invalid",
            error.user_message,
            stage,
            details={"csv_report": error.report.model_dump(mode="json")},
        )
    if isinstance(error, data_errors.DataError):
        code = DATA_CODES.get(error.code, "provider_unavailable")
        return ApiError(code, error.user_message, stage)
    if isinstance(error, IncompatibleMarketError):
        return ApiError("market_not_compatible", str(error), stage)
    if isinstance(error, ParameterError):
        return ApiError(
            "invalid_request",
            "Some strategy parameters are not valid.",
            stage,
            details={"problems": _problem_list(error.problems, "parameters")},
        )
    if isinstance(error, CustomStrategyError):
        return ApiError(
            "invalid_request",
            "The custom strategy description is not valid.",
            stage,
            details={"problems": _problem_list(error.problems, "parameters")},
        )
    if isinstance(error, UnknownStrategyError):
        return ApiError(
            "invalid_request",
            "Unknown strategy.",
            stage,
            details={"problems": [{"field": "strategy_id", "message": "unknown strategy"}]},
        )
    if isinstance(error, BarsValidationError):
        return ApiError(
            "provider_unavailable",
            "The data source returned bars that failed validation.",
            stage,
            details={
                "problems": [
                    {"field": problem.code, "message": problem.message[:160]}
                    for problem in error.problems[:MAX_PROBLEMS]
                ]
            },
        )
    if isinstance(error, SpecError):
        return ApiError("invalid_request", str(error), stage)
    if isinstance(error, SessionError):
        return ApiError("range_invalid", "The dates fall outside the supported calendar.", stage)
    if isinstance(error, ValidationError):
        return ApiError(
            "invalid_request",
            "The request is not valid.",
            stage,
            details={"problems": field_problems(error)},
        )
    return ApiError("internal_error", INTERNAL_MESSAGE, stage)
