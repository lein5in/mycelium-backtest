from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_returns_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_cors_origins_come_from_settings() -> None:
    settings = Settings(allowed_origins="https://a.example, https://b.example")
    client = TestClient(create_app(settings))
    allowed = client.get("/api/health", headers={"Origin": "https://b.example"})
    refused = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert allowed.headers["access-control-allow-origin"] == "https://b.example"
    assert "access-control-allow-origin" not in refused.headers


def test_dev_defaults_use_the_project_ports() -> None:
    settings = Settings(_env_file=None)
    assert settings.dev_port == 8417
    assert settings.dev_host == "127.0.0.1"
    assert settings.allowed_origins == ["http://localhost:5417"]
