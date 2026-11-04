import re
from dataclasses import dataclass

from app.errors import ApiError

MAX_PARTS = 8
MAX_HEADER_BYTES = 2_048
MAX_FIELD_BYTES = 64 * 1024
BOUNDARY = re.compile(r'boundary="?([0-9A-Za-z\'()+_,\-./:=? ]{1,70})"?(?:;|$)')
DISPOSITION_PARAM = re.compile(r';\s*([a-zA-Z*]+)="([^"]*)"')


@dataclass(frozen=True)
class Part:
    name: str
    filename: str | None
    data: bytes

    def text(self) -> str:
        if len(self.data) > MAX_FIELD_BYTES:
            raise invalid(f"The form field {self.name!r} is too long.")
        try:
            return self.data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise invalid(f"The form field {self.name!r} is not UTF-8 text.") from error


def invalid(message: str = "The upload is not a valid multipart form.") -> ApiError:
    return ApiError("invalid_request", message)


def boundary_of(content_type: str) -> bytes:
    match = BOUNDARY.search(content_type)
    if not content_type.lower().startswith("multipart/form-data") or match is None:
        raise invalid()
    return match.group(1).rstrip(" ").encode("latin-1")


def _part(raw: bytes) -> Part:
    if not raw.startswith(b"\r\n") or not raw.endswith(b"\r\n"):
        raise invalid()
    head, separator, data = raw[2:-2].partition(b"\r\n\r\n")
    if not separator or len(head) > MAX_HEADER_BYTES:
        raise invalid()
    disposition = None
    for line in head.decode("utf-8", "replace").split("\r\n"):
        name, _, value = line.partition(":")
        if name.strip().lower() == "content-disposition":
            disposition = value.strip()
    if disposition is None or not disposition.lower().startswith("form-data"):
        raise invalid()
    params = {key.lower(): value for key, value in DISPOSITION_PARAM.findall(disposition)}
    if "name" not in params:
        raise invalid()
    return Part(name=params["name"], filename=params.get("filename"), data=data)


def parse(body: bytes, content_type: str) -> dict[str, Part]:
    delimiter = b"--" + boundary_of(content_type)
    chunks = body.split(delimiter)
    if len(chunks) < 3 or not chunks[-1].startswith(b"--"):
        raise invalid()
    if len(chunks) - 2 > MAX_PARTS:
        raise invalid(f"The form has more than {MAX_PARTS} parts.")
    parts: dict[str, Part] = {}
    for raw in chunks[1:-1]:
        part = _part(raw)
        if part.name in parts:
            raise invalid(f"The form field {part.name!r} appears twice.")
        parts[part.name] = part
    return parts
