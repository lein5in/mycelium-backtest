from typing import Literal

ErrorCode = Literal[
    "network",
    "rate_limited",
    "not_found",
    "bad_payload",
    "out_of_range",
    "invalid_symbol",
    "unsupported",
    "provider_disabled",
    "busy",
    "csv_invalid",
]


class DataError(Exception):
    code: ErrorCode = "network"

    def __init__(self, message: str, provider: str | None = None) -> None:
        self.message = message
        self.provider = provider
        super().__init__(message)

    @property
    def user_message(self) -> str:
        return self.message[:200]


class NetworkError(DataError):
    code: ErrorCode = "network"


class RateLimitedError(DataError):
    code: ErrorCode = "rate_limited"


class NotFoundError(DataError):
    code: ErrorCode = "not_found"


class BadPayloadError(DataError):
    code: ErrorCode = "bad_payload"


class OutOfRangeError(DataError):
    code: ErrorCode = "out_of_range"


class InvalidSymbolError(DataError):
    code: ErrorCode = "invalid_symbol"


class UnsupportedError(DataError):
    code: ErrorCode = "unsupported"


class ProviderDisabledError(DataError):
    code: ErrorCode = "provider_disabled"


class BusyError(DataError):
    code: ErrorCode = "busy"
