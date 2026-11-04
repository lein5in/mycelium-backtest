import json
import logging
import uuid
from dataclasses import dataclass

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.errors import error_body, error_headers
from app.config import Settings
from app.errors import INTERNAL_MESSAGE, ApiError
from app.jobs.limits import ClientKeys, RequestRate

logger = logging.getLogger("mycelium.api")

MULTIPART_PATHS = ("/api/runs/csv", "/api/csv/preview")
MULTIPART_OVERHEAD = 64 * 1024
DOCS_PATHS = ("/api/docs", "/api/redoc", "/api/openapi.json")
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
}
API_CSP = "default-src 'none'; frame-ancestors 'none'"


@dataclass(frozen=True)
class BodyRule:
    limit: int
    content_type: str | None
    code: str


class ApiGuard:
    def __init__(self, app: ASGIApp, settings: Settings, keys: ClientKeys, rate: RequestRate):
        self.app = app
        self.settings = settings
        self.keys = keys
        self.rate = rate

    def rule(self, path: str) -> BodyRule:
        if path in MULTIPART_PATHS:
            return BodyRule(
                self.settings.max_csv_bytes + MULTIPART_OVERHEAD,
                "multipart/form-data",
                "file_too_large",
            )
        return BodyRule(self.settings.max_json_bytes, "application/json", "invalid_request")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = uuid.uuid4().hex[:16]
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        path: str = scope["path"]
        headers = Headers(scope=scope)
        peer = scope.get("client")[0] if scope.get("client") else None
        state["client_key"] = self.keys.key(peer, headers.get("x-forwarded-for"))
        started = False
        rejected = False

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if rejected and message["type"].startswith("http.response"):
                return
            if message["type"] == "http.response.start":
                started = True
                out = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    out.setdefault(name, value)
                if not path.startswith(DOCS_PATHS):
                    out.setdefault("Content-Security-Policy", API_CSP)
                out["X-Request-ID"] = request_id
            await send(message)

        async def reject(error: ApiError) -> None:
            nonlocal rejected
            body = json.dumps(error_body(error, request_id)).encode("utf-8")
            response_headers = [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ]
            response_headers += [
                (name.lower().encode(), value.encode())
                for name, value in error_headers(error).items()
            ]
            await guarded_send(
                {"type": "http.response.start", "status": error.status, "headers": response_headers}
            )
            await guarded_send({"type": "http.response.body", "body": body})
            rejected = True

        if path.startswith("/api/") and scope["method"] != "OPTIONS":
            wait = self.rate.hit(state["client_key"])
            if wait is not None:
                await reject(
                    ApiError("rate_limited", "Too many requests; slow down.", retry_after=wait)
                )
                return

        limited_receive = receive
        if scope["method"] in ("POST", "PUT", "PATCH"):
            rule = self.rule(path)
            declared = headers.get("content-length")
            has_body = (declared not in (None, "0")) or "transfer-encoding" in headers
            content_type = headers.get("content-type", "").lower()
            if has_body and rule.content_type and not content_type.startswith(rule.content_type):
                await reject(
                    ApiError("invalid_request", f"Send this request as {rule.content_type}.")
                )
                return
            too_large = ApiError(rule.code, self._too_large_message(rule))
            if declared is not None and declared.isdigit() and int(declared) > rule.limit:
                await reject(too_large)
                return
            received = 0

            async def limited_receive() -> Message:
                nonlocal received
                if rejected:
                    return {"type": "http.disconnect"}
                message = await receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > rule.limit:
                        await reject(too_large)
                        return {"type": "http.disconnect"}
                return message

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception as error:
            if rejected:
                return
            logger.error(
                "request %s: unexpected %s", request_id, type(error).__name__, exc_info=True
            )
            if not started:
                await reject(ApiError("internal_error", INTERNAL_MESSAGE))

    def _too_large_message(self, rule: BodyRule) -> str:
        if rule.code == "file_too_large":
            megabytes = self.settings.max_csv_bytes / (1024 * 1024)
            return f"The file is larger than the {megabytes:g} MB limit."
        return f"The request body is larger than {self.settings.max_json_bytes // 1024} KB."
