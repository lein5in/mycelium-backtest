import time
from datetime import UTC, datetime


def _event(payload):
    return ("event", {**payload, "ts": datetime.now(UTC).isoformat()})


def stuck_child(connection, run_id, job, settings_values, csv_content):
    connection.send(_event({"type": "run_started", "bar_count": 10}))
    connection.send(_event({"type": "stage_started", "stage": "DATA"}))
    while True:
        time.sleep(1)


def crashing_child(connection, run_id, job, settings_values, csv_content):
    connection.send(_event({"type": "run_started", "bar_count": 10}))
    raise SystemExit(3)


def quick_child(connection, run_id, job, settings_values, csv_content):
    connection.send(_event({"type": "run_started", "bar_count": 10}))
    connection.send(("result", b"{}"))
    connection.send(_event({"type": "run_done", "verdict": "FRAGILE"}))
    connection.send(("finished", None))


def fake_coinbase_registry(settings):
    import httpx2

    from app.data.registry import DataRegistry
    from tests.data.fakes import coinbase_handler, now

    def factory():
        return httpx2.Client(transport=httpx2.MockTransport(coinbase_handler()))

    registry = DataRegistry(settings, client_factory=factory, now=now)
    registry._limiters["coinbase"].min_interval = 0.0
    return registry


def fake_coinbase_child(connection, run_id, job, settings_values, csv_content):
    from app.jobs.worker import run_child

    run_child(connection, run_id, job, settings_values, csv_content, fake_coinbase_registry)


def pid_child(connection, run_id, job, settings_values, csv_content):
    import os

    connection.send(_event({"type": "run_started", "bar_count": 10}))
    connection.send(("result", str(os.getpid()).encode()))
    connection.send(_event({"type": "run_done", "verdict": "FRAGILE"}))
    connection.send(("finished", None))


def fake_kraken_registry(settings):
    import httpx2
    import pandas as pd

    from app.data.registry import DataRegistry
    from tests.data.fakes import NOW, kraken_ohlc, now

    rows = kraken_ohlc(60, 720, NOW.floor("h") - pd.Timedelta(hours=1))

    def handle(request):
        return httpx2.Response(200, json={"error": [], "result": {"XXBTZUSD": rows, "last": 1}})

    def factory():
        return httpx2.Client(transport=httpx2.MockTransport(handle))

    return DataRegistry(settings, client_factory=factory, now=now)


def fake_kraken_child(connection, run_id, job, settings_values, csv_content):
    from app.jobs.worker import run_child

    run_child(connection, run_id, job, settings_values, csv_content, fake_kraken_registry)
