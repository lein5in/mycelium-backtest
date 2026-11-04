import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, JsonValue
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.error_codes import ErrorCode
from app.errors import ApiError

logger = logging.getLogger("mycelium.api")

NO_STORE = {"Cache-Control": "no-store"}


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: ErrorCode
    status: int
    message: str
    stage: str | None = None
    details: JsonValue = None
    request_id: str


def request_id_of(scope_state: dict) -> str:
    return str(scope_state.get("request_id", "unknown"))


def error_body(error: ApiError, request_id: str) -> dict:
    return ErrorBody(
        code=error.code,
        status=error.status,
        message=error.message,
        stage=error.stage,
        details=error.details,
        request_id=request_id,
    ).model_dump(mode="json")


def error_headers(error: ApiError) -> dict[str, str]:
    headers = {**NO_STORE, **error.headers}
    if error.retry_after is not None:
        headers["Retry-After"] = str(error.retry_after)
    return headers


def error_response(error: ApiError, request_id: str) -> JSONResponse:
    return JSONResponse(
        error_body(error, request_id), status_code=error.status, headers=error_headers(error)
    )


def _request_id(request: Request) -> str:
    return request_id_of(request.scope.get("state", {}))


def _validation_problems(error: RequestValidationError) -> list[dict[str, str]]:
    problems = []
    for item in error.errors()[:50]:
        location = [str(part) for part in item.get("loc", ()) if part != "body"]
        problems.append(
            {"field": ".".join(location) or "body", "message": str(item.get("msg", ""))[:160]}
        )
    return problems


async def handle_api_error(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, ApiError)
    return error_response(error, _request_id(request))


async def handle_validation(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, RequestValidationError)
    api_error = ApiError(
        "invalid_request",
        "The request is not valid.",
        details={"problems": _validation_problems(error)},
    )
    return error_response(api_error, _request_id(request))


async def handle_http(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, StarletteHTTPException)
    if error.status_code == 404:
        api_error = ApiError("not_found", "No such endpoint.")
    elif error.status_code == 405:
        api_error = ApiError("invalid_request", "This method is not allowed here.")
    else:
        api_error = ApiError("invalid_request", "The request could not be processed.")
    return error_response(api_error, _request_id(request))


def install(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(RequestValidationError, handle_validation)
    app.add_exception_handler(StarletteHTTPException, handle_http)
