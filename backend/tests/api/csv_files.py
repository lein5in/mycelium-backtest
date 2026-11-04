from datetime import UTC, datetime

from app.data.samples import fetch_sample

MARKER = "MYCELIUM-PRIVATE-MARKER"


def sample_csv(days: int = 20, problems: bool = False) -> bytes:
    data = fetch_sample(
        "SAMPLE-A", "5m", datetime(2024, 1, 2, tzinfo=UTC), datetime(2024, 1, 2 + days, tzinfo=UTC)
    )
    bars = data.bars
    lines = [f"timestamp,open,high,low,close,volume,note_{MARKER}"]
    for i in range(bars.size):
        stamp = bars.timestamp(i).strftime("%Y-%m-%dT%H:%M:%SZ")
        row = [bars.open[i], bars.high[i], bars.low[i], bars.close[i], bars.volume[i]]
        cells = [stamp, *(f"{value:.4f}" for value in row), MARKER]
        if problems and i in (5, 9):
            cells[1] = "abc"
        if problems and i == 12:
            cells[3] = "-1"
        lines.append(",".join(cells))
    return ("\n".join(lines) + "\n").encode("utf-8")


def multipart(fields: dict[str, str], content: bytes | None, boundary: str = "testboundary42"):
    chunks = []
    for name, value in fields.items():
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'
        chunks.append(head.encode() + value.encode() + b"\r\n")
    if content is not None:
        head = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="bars.csv"\r\n'
            "Content-Type: text/csv\r\n\r\n"
        )
        chunks.append(head.encode() + content + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"
